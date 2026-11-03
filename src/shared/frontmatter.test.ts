import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assigneeField, formatField, replaceBody, setFields } from './frontmatter'
import { parseTicket } from './ticket'

const ticket = `---
id: 20261018-1356-k3x9
status: todo
priority: 2
start:
due: 2026-10-22
repeat:
tags: [仕事, A社]   # コメントも残る
parent:
assignee:
created: 2026-10-18
done:
---

# 見積書を送る
`

/** 2つの文字列で、違う行だけを [前, 後] の組で返す */
function changedLines(before: string, after: string): Array<[string, string]> {
  const a = before.split('\n')
  const b = after.split('\n')
  expect(b).toHaveLength(a.length)
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]] as [string, string]]))
}

describe('formatField', () => {
  it.each([
    ['status', 'doing', 'status: doing'],
    ['priority', 1, 'priority: 1'],
    ['due', '2026-10-22', 'due: 2026-10-22'],
    ['due', null, 'due:'],
    ['repeat', 'weekly:mon', 'repeat: weekly:mon'],
    ['parent', '20261015-0930-p2m7', 'parent: 20261015-0930-p2m7'],
    ['tags', ['仕事', 'A社'], 'tags: [仕事, A社]'],
    ['tags', [], 'tags: []'],
    ['tags', ['a, b', 'c]'], 'tags: ["a, b", "c]"]'],
    ['assignee', '山田: 経理', 'assignee: "山田: 経理"'],
    ['assignee', '123', 'assignee: "123"'],
    ['assignee', ' 前後に空白 ', 'assignee: " 前後に空白 "']
  ] as const)('%s = %j → %s', (key, value, expected) => {
    expect(formatField(key, value as never)).toBe(expected)
  })

  it('書いた値は同じ値として読める', () => {
    const tags = ['a, b', 'c]', '#見出し', 'yes', '1']
    const text = `---\n${formatField('tags', tags)}\n---\n`
    expect(parseTicket('x.md', text).tags).toEqual(tags)
  })
})

describe('setFields', () => {
  it('変えた項目の行だけを書き換える', () => {
    const after = setFields(ticket, { status: 'doing', due: '2026-10-25' })
    expect(changedLines(ticket, after)).toEqual([
      ['status: todo', 'status: doing'],
      ['due: 2026-10-22', 'due: 2026-10-25']
    ])
  })

  it('値が同じなら書き換えない（コメントや書き方も残す）', () => {
    expect(setFields(ticket, { tags: ['仕事', 'A社'], priority: 2, start: null })).toBe(ticket)
  })

  it('空にすると `項目:` の行だけ残す', () => {
    expect(changedLines(ticket, setFields(ticket, { due: null }))).toEqual([
      ['due: 2026-10-22', 'due:']
    ])
  })

  it('タグを書き換えるとコメントは消える（その行は書き換えるため）', () => {
    expect(changedLines(ticket, setFields(ticket, { tags: ['仕事'] }))).toEqual([
      ['tags: [仕事, A社]   # コメントも残る', 'tags: [仕事]']
    ])
  })

  it('複数行のタグは続きの行もまとめて置き換える', () => {
    const text = '---\nid: x\ntags:\n  - 仕事\n  - A社\nparent:\n---\n'
    expect(setFields(text, { tags: ['家'] })).toBe('---\nid: x\ntags: [家]\nparent:\n---\n')
  })

  it('行がない項目は、並び順の位置に足す', () => {
    const text = '---\nid: x\nstatus: todo\ncreated: 2026-10-18\n---\n\n# t\n'
    expect(setFields(text, { due: '2026-10-22', done: '2026-10-20' })).toBe(
      '---\nid: x\nstatus: todo\ndue: 2026-10-22\ncreated: 2026-10-18\ndone: 2026-10-20\n---\n\n# t\n'
    )
  })

  it('CRLF のファイルでも改行コードを変えない', () => {
    const crlf = ticket.replace(/\n/g, '\r\n')
    expect(setFields(crlf, { status: 'done' })).toBe(
      crlf.replace('status: todo\r\n', 'status: done\r\n')
    )
  })

  it('本文の中の同じ名前の行には触れない', () => {
    const text = '---\nstatus: todo\n---\n\nstatus: todo\n'
    expect(setFields(text, { status: 'done' })).toBe('---\nstatus: done\n---\n\nstatus: todo\n')
  })

  it('テンプレートにも使える', () => {
    const template = readFileSync(resolve(__dirname, '../../templates/TEMPLATE.md'), 'utf8')
    const after = setFields(template, { priority: 1 })
    expect(changedLines(template, after)).toEqual([['priority: 2', 'priority: 1']])
  })

  it('frontmatter がなければエラー', () => {
    expect(() => setFields('# だけ\n', { status: 'done' })).toThrow()
  })
})

describe('replaceBody', () => {
  it('frontmatter はそのままで、本文だけを差し替える', () => {
    expect(replaceBody(ticket, '\n# 新しい本文\n')).toBe(
      ticket.replace('\n# 見積書を送る\n', '\n# 新しい本文\n')
    )
  })

  it('frontmatter がなければ全体を本文とみなす', () => {
    expect(replaceBody('# だけ\n', '# 新しい本文\n')).toBe('# 新しい本文\n')
  })
})

describe('担当者（assigneeField）', () => {
  const base = '---\nid: a\nassignee: 高橋\nauthor:\n---\n'

  it('1人なら文字列、2人以上ならリスト、0人なら空で書く', () => {
    expect(assigneeField([])).toBeNull()
    expect(assigneeField(['高橋'])).toBe('高橋')
    expect(assigneeField(['高橋', '田中', '高橋'])).toEqual(['高橋', '田中'])
    expect(setFields(base, { assignee: assigneeField(['高橋', '田中']) })).toBe(
      '---\nid: a\nassignee: [高橋, 田中]\nauthor:\n---\n'
    )
  })

  it('2人から1人に減らしたら文字列に戻す。同じ1人なら書き換えない', () => {
    const two = '---\nid: a\nassignee: [高橋, 田中]\nauthor:\n---\n'
    expect(setFields(two, { assignee: assigneeField(['高橋']) })).toBe(base)
    expect(setFields(base, { assignee: assigneeField(['高橋']) })).toBe(base)
    expect(setFields(base, { assignee: assigneeField([]) })).toBe(
      '---\nid: a\nassignee:\nauthor:\n---\n'
    )
  })
})
