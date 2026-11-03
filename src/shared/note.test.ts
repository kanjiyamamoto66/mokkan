import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOTE_FIELD_ORDER, setFields } from './frontmatter'
import {
  appendHomework,
  attachHomework,
  hasBackLink,
  listNotes,
  parseHomeworkItem,
  parseNote,
  plainListItem,
  ticketsFromNote,
  type Note
} from './note'
import { findWarnings, parseTicket, type Ticket } from './ticket'

const noteTemplate = readFileSync(resolve(__dirname, '../../templates/NOTE_TEMPLATE.md'), 'utf8')

const meeting = `---
id: 20261019-1400-m3k8
date: 2026-10-19
tags: [A社, 定例]
author: 山田
created: 2026-10-20
---

# A社定例

## 要点

## 宿題
- 見積書を送る（高橋）→ 20261019-1512-x7q2

## 文字起こし
高橋: 見積書を送ります
`

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    fileName: `notes/${partial.id}.md`,
    fileId: partial.id,
    title: '',
    date: null,
    tags: [],
    author: null,
    created: null,
    modified: null,
    parseError: null,
    ...partial
  }
}

describe('parseNote', () => {
  it('frontmatter とタイトルを読む', () => {
    expect(parseNote('notes/20261019-1400-m3k8_A社定例.md', meeting)).toEqual({
      fileName: 'notes/20261019-1400-m3k8_A社定例.md',
      fileId: '20261019-1400-m3k8',
      id: '20261019-1400-m3k8',
      title: 'A社定例',
      date: '2026-10-19',
      tags: ['A社', '定例'],
      author: '山田',
      created: '2026-10-20',
      modified: null,
      parseError: null
    })
  })

  it('ファイル名だけを渡しても notes/ のキーにする', () => {
    expect(parseNote('20261019-1400-m3k8.md', meeting).fileName).toBe('notes/20261019-1400-m3k8.md')
  })

  it('frontmatter がなければ理由を持つ', () => {
    const n = parseNote('notes/memo.md', '# メモ\n')
    expect(n.parseError).toContain('frontmatter')
    expect(n.title).toBe('メモ')
    expect(n.fileId).toBeNull()
  })

  it('NOTE_TEMPLATE.md は日付・タイトルが空のノートとして読める', () => {
    const n = parseNote('notes/x.md', noteTemplate)
    expect(n.parseError).toBeNull()
    expect([n.id, n.date, n.title, n.tags]).toEqual([null, null, '', []])
  })
})

describe('NOTE_FIELD_ORDER', () => {
  it('ノートの項目を、行がなければ並び順の位置に足す', () => {
    const text = '---\nid: a\ncreated: 2026-10-20\n---\n'
    expect(setFields(text, { date: '2026-10-19', author: '山田' }, NOTE_FIELD_ORDER)).toBe(
      '---\nid: a\ndate: 2026-10-19\nauthor: 山田\ncreated: 2026-10-20\n---\n'
    )
  })

  it('チケットの並び順では、ノートの項目（date）を書かない', () => {
    const text = '---\nid: a\n---\n'
    expect(setFields(text, { date: '2026-10-19' })).toBe(text)
  })
})

describe('listNotes', () => {
  const notes = [
    note({ id: '20261001-0900-aaaa', date: '2026-10-01', tags: ['A社'] }),
    note({ id: '20261020-0900-bbbb', date: null, created: '2026-10-20' }),
    note({ id: '20261019-0900-cccc', date: '2026-10-19', tags: ['B社'] }),
    note({ id: '20261019-1000-dddd', date: '2026-10-19' }),
    note({ id: '20261021-0900-eeee', date: null, created: null })
  ]

  it('日付の新しい順（date がなければ created）、同じ日は ID の新しい順。日付のないものは最後', () => {
    expect(listNotes(notes, []).map((n) => n.id)).toEqual([
      '20261020-0900-bbbb',
      '20261019-1000-dddd',
      '20261019-0900-cccc',
      '20261001-0900-aaaa',
      '20261021-0900-eeee'
    ])
  })

  it('タグで絞り込む', () => {
    expect(listNotes(notes, ['A社', 'B社']).map((n) => n.id)).toEqual([
      '20261019-0900-cccc',
      '20261001-0900-aaaa'
    ])
  })
})

describe('ticketsFromNote と警告', () => {
  const ticketWith = (id: string, source: string | null): Ticket => ({
    ...parseTicket(`${id}.md`, `---\nid: ${id}\nstatus: todo\n---\n`),
    source
  })
  const n = note({ id: '20261019-1400-m3k8' })

  it('source がこのノートのチケットを返す', () => {
    const tickets = [
      ticketWith('20261019-1500-aaaa', '20261019-1400-m3k8'),
      ticketWith('20261019-1500-bbbb', null),
      ticketWith('20261019-1500-cccc', '20261001-0000-zzzz')
    ]
    expect(ticketsFromNote(n, tickets).map((t) => t.id)).toEqual(['20261019-1500-aaaa'])
    expect(ticketsFromNote(note({ id: 'x', fileId: 'x' }), tickets)).toEqual([])
  })

  it('チケットの source を読む', () => {
    expect(parseTicket('a.md', '---\nid: a\nsource: 20261019-1400-m3k8\n---\n').source).toBe(
      '20261019-1400-m3k8'
    )
  })

  it('元のノートが見つからないチケットと、チケットとノートで重なった ID を警告する', () => {
    const tickets = [
      ticketWith('20261019-1500-aaaa', '20261019-1400-m3k8'),
      ticketWith('20261019-1500-bbbb', '20261001-0000-zzzz'),
      ticketWith('20261019-1500-cccc', null)
    ]
    const notes = [n, note({ id: '20261019-1500-cccc' })]
    expect(findWarnings(tickets, notes).map((w) => [w.kind, w.fileNames])).toEqual([
      ['duplicate-id', ['20261019-1500-cccc.md', 'notes/20261019-1500-cccc.md']],
      ['missing-source', ['20261019-1500-bbbb.md']]
    ])
  })

  it('ノートのファイル名と id の食い違いも警告する', () => {
    const notes = [note({ id: '20261019-1400-m3k8', fileId: '20261019-1400-zzzz' })]
    expect(findWarnings([], notes).map((w) => w.kind)).toEqual(['id-mismatch'])
  })
})

describe('appendHomework', () => {
  const fm = '---\nid: a\n---\n'

  it('宿題の箇条書きの最後に足し、ほかは変えない', () => {
    expect(appendHomework(meeting, '請求書を送る → 20261020-0900-aaaa')).toBe(
      meeting.replace(
        '→ 20261019-1512-x7q2\n',
        '→ 20261019-1512-x7q2\n- 請求書を送る → 20261020-0900-aaaa\n'
      )
    )
  })

  it('宿題の見出しだけで中身がなければ、空行をはさんで足す', () => {
    const text = `${fm}\n# 定例\n\n## 宿題\n\n## 文字起こし\n本文\n`
    expect(appendHomework(text, 'A → x')).toBe(
      `${fm}\n# 定例\n\n## 宿題\n\n- A → x\n\n## 文字起こし\n本文\n`
    )
  })

  it('宿題の見出しのすぐ後に次の見出しがあっても、空行をはさむ', () => {
    const text = `${fm}\n## 宿題\n## 文字起こし\n`
    expect(appendHomework(text, 'A → x')).toBe(`${fm}\n## 宿題\n\n- A → x\n\n## 文字起こし\n`)
  })

  it('宿題が本文の最後なら、その最後に足す', () => {
    expect(appendHomework(`${fm}\n## 宿題\n- A → x\n`, 'B → y')).toBe(
      `${fm}\n## 宿題\n- A → x\n- B → y\n`
    )
    expect(appendHomework(`${fm}\n## 宿題\n`, 'B → y')).toBe(`${fm}\n## 宿題\n\n- B → y\n`)
  })

  it('宿題の最後が段落なら、空行をはさんでリストにする', () => {
    expect(appendHomework(`${fm}\n## 宿題\nまだない\n`, 'B → y')).toBe(
      `${fm}\n## 宿題\nまだない\n\n- B → y\n`
    )
  })

  it('宿題の下の小見出しも宿題に含める', () => {
    const text = `${fm}\n## 宿題\n### A社\n- A → x\n## 文字起こし\n`
    expect(appendHomework(text, 'B → y')).toBe(
      `${fm}\n## 宿題\n### A社\n- A → x\n- B → y\n## 文字起こし\n`
    )
  })

  it('宿題の見出しがなければ、文字起こしの前に見出しごと足す', () => {
    const text = `${fm}\n# 定例\n\n## 要点\nなし\n## 文字起こし\n本文\n`
    expect(appendHomework(text, 'A → x')).toBe(
      `${fm}\n# 定例\n\n## 要点\nなし\n\n## 宿題\n\n- A → x\n\n## 文字起こし\n本文\n`
    )
  })

  it('宿題も文字起こしもなければ、本文の最後に見出しごと足す', () => {
    expect(appendHomework(`${fm}\n# 定例\n\nメモ\n\n\n`, 'A → x')).toBe(
      `${fm}\n# 定例\n\nメモ\n\n## 宿題\n\n- A → x\n`
    )
    expect(appendHomework(`${fm}`, 'A → x')).toBe(`${fm}## 宿題\n\n- A → x\n`)
  })

  it('コードブロックの中の「宿題」は見出しとみなさない', () => {
    const text = `${fm}\n\`\`\`${fm}\n## 宿題\n\`\`\`\n`
    expect(appendHomework(text, 'A → x')).toBe(`${text}\n## 宿題\n\n- A → x\n`)
  })

  it('改行が CRLF のファイルには CRLF で足す', () => {
    const text = '---\r\nid: a\r\n---\r\n\r\n## 宿題\r\n- A → x\r\n'
    expect(appendHomework(text, 'B → y')).toBe(
      '---\r\nid: a\r\n---\r\n\r\n## 宿題\r\n- A → x\r\n- B → y\r\n'
    )
  })
})

describe('attachHomework（選んだ宿題の行に → を付ける）', () => {
  const fm = '---\nid: n\n---\n'
  const link = ' → [20261020-0900-aaaa](../tickets/20261020-0900-aaaa_資料.md)'

  it('文が同じ項目の行末に付け、ほかは1文字も変えない', () => {
    const text = `${fm}\n## 宿題\n- 見積書を送る（高橋）\n- **資料**を共有フォルダに置く\n\n## 文字起こし\n資料を共有フォルダに置く\n`
    expect(attachHomework(text, '資料を共有フォルダに置く', link)).toBe(
      `${fm}\n## 宿題\n- 見積書を送る（高橋）\n- **資料**を共有フォルダに置く${link}\n\n## 文字起こし\n資料を共有フォルダに置く\n`
    )
  })

  it('同じ文の項目が複数あれば、まだ → の付いていない最初の項目にする。すでに付いていれば null', () => {
    const text = `${fm}\n## 宿題\n- A → 20261019-0900-zzzz\n- A\n- A\n`
    expect(attachHomework(text, 'A', link)).toBe(
      `${fm}\n## 宿題\n- A → 20261019-0900-zzzz\n- A${link}\n- A\n`
    )
    expect(attachHomework(`${fm}\n## 宿題\n- A → 20261019-0900-zzzz\n`, 'A', link)).toBeNull()
  })

  it('「宿題」の外や、見つからないときは null', () => {
    expect(attachHomework(`${fm}\n## 要点\n- A\n`, 'A', link)).toBeNull()
    expect(attachHomework(`${fm}\n## 宿題\n- B\n`, 'A', link)).toBeNull()
  })

  it('チェックボックスや CRLF の行でも付ける。行末の空白も残す（付けたもののほかは変えない）', () => {
    const text = '---\r\nid: n\r\n---\r\n## 宿題\r\n- [ ] A  \r\n'
    expect(attachHomework(text, 'A', link)).toBe(
      `---\r\nid: n\r\n---\r\n## 宿題\r\n- [ ] A  ${link}\r\n`
    )
  })

  it('単語の中の _ や、括弧を含むリンク先の項目も見つける', () => {
    const text = `${fm}\n## 宿題\n- snake_case の名前を直す\n- [資料](<a (1).md>)を置く\n`
    expect(attachHomework(text, 'snake_case の名前を直す', link)).toContain(
      `- snake_case の名前を直す${link}\n`
    )
    expect(attachHomework(text, '資料を置く', link)).toContain(
      `- [資料](<a (1).md>)を置く${link}\n`
    )
  })
})

describe('宿題の項目の読み取り', () => {
  it('書式を除いた文を取り出す', () => {
    expect(plainListItem('- [ ] **見積書**を[送る](https://x)  ')).toBe('見積書を送る')
    expect(plainListItem('1. `コード`と\\*記号')).toBe('コードと*記号')
    // 文字に挟まれた _ は、CommonMark でも強調にならないので残す
    expect(plainListItem('- *斜体*と_斜体_と~~消し~~、snake_case')).toBe(
      '斜体と_斜体_と消し、snake_case'
    )
  })

  it('行末の（担当者）を担当者として取り出す。→ のリンクは除く', () => {
    expect(parseHomeworkItem('見積書を送る（高橋）')).toEqual({
      title: '見積書を送る',
      assignees: ['高橋']
    })
    expect(parseHomeworkItem('資料を作る(高橋・田中)')).toEqual({
      title: '資料を作る',
      assignees: ['高橋', '田中']
    })
    expect(parseHomeworkItem('見積書を送る（高橋）→ 20261019-1512-x7q2')).toEqual({
      title: '見積書を送る',
      assignees: ['高橋']
    })
    expect(parseHomeworkItem('日程を決める')).toEqual({ title: '日程を決める', assignees: [] })
    expect(hasBackLink('A → 20261019-1512-x7q2')).toBe(true)
    expect(hasBackLink('A → [20261019-1512-x7q2](../tickets/x.md)')).toBe(true)
    expect(hasBackLink('A（高橋）')).toBe(false)
  })
})
