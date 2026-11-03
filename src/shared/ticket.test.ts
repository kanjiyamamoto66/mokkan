import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  type ListSort,
  type Ticket,
  UNASSIGNED,
  asListSort,
  collectAssignees,
  collectTags,
  createdLabel,
  fillTemplate,
  findWarnings,
  generateId,
  ID_PATTERN,
  idFromFileName,
  isTicketFileName,
  listTickets,
  parseTicket,
  splitFrontmatter,
  titleFromBody
} from './ticket'

const template = readFileSync(resolve(__dirname, '../../templates/TEMPLATE.md'), 'utf8')

const sample = `---
id: 20261018-1356-k3x9
status: todo
priority: 1
start: 2026-10-19
due: 2026-10-22
repeat:
tags: [仕事, A社]
parent: 20261015-0930-p2m7
assignee:
created: 2026-10-18
done:
---

# 見積書を送る

## メモ
- 金額は前回と同じでいいか確認する
`

/** 一覧や警告のテスト用に、必要な項目だけ指定してチケットを作る */
function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    fileName: `${partial.id}.md`,
    archived: false,
    fileId: partial.id,
    title: '',
    status: 'todo',
    priority: null,
    start: null,
    due: null,
    repeat: null,
    tags: [],
    parent: null,
    source: null,
    assignee: [],
    author: null,
    created: null,
    done: null,
    modified: null,
    parseError: null,
    ...partial
  }
}

describe('generateId', () => {
  it('現地時刻とランダムな4文字から YYYYMMDD-HHMM-xxxx を作る', () => {
    const id = generateId(new Date(2026, 9, 8, 9, 5), (max) => max - 1)
    expect(id).toBe('20261008-0905-9999')
  })

  it('ランダム部分は英小文字と数字だけになる', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateId(new Date(), (max) => Math.floor(Math.random() * max))
      expect(id).toMatch(ID_PATTERN)
    }
  })
})

describe('createdLabel', () => {
  it('ID の先頭の時刻を付けて表示する', () => {
    expect(createdLabel(ticket({ id: '20261018-2212-k3x9', created: '2026-10-18' }))).toBe(
      '2026-10-18 22:12'
    )
  })

  it('created と ID の日付が食い違うときは created だけを出す', () => {
    expect(createdLabel(ticket({ id: '20261017-2359-k3x9', created: '2026-10-18' }))).toBe(
      '2026-10-18'
    )
  })

  it('ID の形が違う・時刻がありえない値なら created だけ、created が空なら null', () => {
    expect(createdLabel(ticket({ id: 'memo', fileId: null, created: '2026-10-18' }))).toBe(
      '2026-10-18'
    )
    expect(createdLabel(ticket({ id: '20261018-2512-k3x9', created: '2026-10-18' }))).toBe(
      '2026-10-18'
    )
    expect(createdLabel(ticket({ id: '20261018-2212-k3x9' }))).toBeNull()
  })

  it('frontmatter の id が空なら、ファイル名の ID を使う', () => {
    const t = ticket({ id: '20261018-0905-k3x9', created: '2026-10-18' })
    expect(createdLabel({ ...t, id: null })).toBe('2026-10-18 09:05')
  })
})

describe('ファイル名', () => {
  it.each([
    ['20261018-1356-k3x9.md', '20261018-1356-k3x9'],
    ['20261018-1356-k3x9_見積書を送る.md', '20261018-1356-k3x9'],
    ['20261018-1356-k3x9_.md', '20261018-1356-k3x9'],
    ['見積書を送る.md', null],
    ['20261018-1356-k3x9 (1).md', null],
    ['20261018-1356-K3X9.md', null],
    ['20261018-1356-k3x9.txt', null]
  ])('%s → %s', (fileName, id) => {
    expect(idFromFileName(fileName)).toBe(id)
  })

  it.each([
    ['20261018-1356-k3x9.md', true],
    ['競合コピー.md', true],
    ['.hidden.md', false],
    ['~$temp.md', false],
    ['desktop.ini', false],
    ['20261018-1356-k3x9.md.tmp', false]
  ])('%s を読み込むか → %s', (fileName, expected) => {
    expect(isTicketFileName(fileName)).toBe(expected)
  })
})

describe('splitFrontmatter / titleFromBody', () => {
  it('frontmatter と本文に分ける', () => {
    const split = splitFrontmatter(sample)
    expect(split?.frontmatter.startsWith('id: 20261018-1356-k3x9\n')).toBe(true)
    expect(split?.frontmatter.endsWith('done:\n')).toBe(true)
    expect(split?.body.startsWith('\n# 見積書を送る')).toBe(true)
  })

  it('分けた部分をつなげ直すと元に戻る', () => {
    const split = splitFrontmatter(sample)!
    expect(`---\n${split.frontmatter}---\n${split.body}`).toBe(sample)
  })

  it('frontmatter がなければ null', () => {
    expect(splitFrontmatter('# タイトルだけ\n')).toBeNull()
    expect(splitFrontmatter('---\nid: x\n')).toBeNull()
  })

  it('最初の # 見出しをタイトルにする', () => {
    expect(titleFromBody('\n# 見積書を送る\n\n## メモ\n')).toBe('見積書を送る')
    expect(titleFromBody('\n## メモ\n# 後の見出し\n')).toBe('後の見出し')
    expect(titleFromBody('\n#\n')).toBe('')
    expect(titleFromBody('\n#タグ風\n')).toBe('')
  })
})

describe('parseTicket', () => {
  it('仕様書の例を読み取る', () => {
    const t = parseTicket('20261018-1356-k3x9_見積書を送る.md', sample)
    expect(t).toMatchObject({
      fileId: '20261018-1356-k3x9',
      id: '20261018-1356-k3x9',
      title: '見積書を送る',
      status: 'todo',
      priority: 1,
      start: '2026-10-19',
      due: '2026-10-22',
      repeat: null,
      tags: ['仕事', 'A社'],
      parent: '20261015-0930-p2m7',
      assignee: [],
      created: '2026-10-18',
      done: null,
      parseError: null
    })
  })

  it('テンプレートそのままでも読める（空の項目は null）', () => {
    const t = parseTicket('x.md', template)
    expect(t.parseError).toBeNull()
    expect(t).toMatchObject({ id: null, status: 'todo', priority: 2, tags: [], title: '' })
  })

  it('CRLF のファイルも読める', () => {
    const t = parseTicket('20261018-1356-k3x9.md', sample.replace(/\n/g, '\r\n'))
    expect(t).toMatchObject({ id: '20261018-1356-k3x9', title: '見積書を送る', due: '2026-10-22' })
  })

  it('不正な値は null にする', () => {
    const t = parseTicket('a.md', '---\nstatus: finished\npriority: 5\ntags: 仕事\n---\n')
    expect(t).toMatchObject({ status: null, priority: null, tags: ['仕事'] })
  })

  it('YAML が壊れていたら parseError に理由を入れる', () => {
    expect(parseTicket('a.md', '---\ntags: [仕事\n---\n').parseError).toMatch(
      /frontmatter を読めません/
    )
    expect(parseTicket('a.md', '# だけ\n').parseError).toMatch(/frontmatter/)
  })
})

describe('fillTemplate', () => {
  it('id と created の行だけを書き換え、それ以外は1文字も変えない', () => {
    const filled = fillTemplate(template, '20261018-1356-k3x9', '2026-10-18')
    const before = template.split('\n')
    const after = filled.split('\n')
    expect(after).toHaveLength(before.length)
    const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]))
    expect(changed).toEqual([
      ['id:', 'id: 20261018-1356-k3x9'],
      ['created:', 'created: 2026-10-18']
    ])
  })

  it('本文の中の id: や created: には触れない', () => {
    const t = '---\nid:\ncreated:\n---\n\nid: 本文\ncreated: 本文\n'
    expect(fillTemplate(t, 'X', 'Y')).toBe(
      '---\nid: X\ncreated: Y\n---\n\nid: 本文\ncreated: 本文\n'
    )
  })

  it('CRLF のテンプレートでも改行を変えない', () => {
    const crlf = '---\r\nid:\r\nstatus: todo\r\ncreated:\r\n---\r\n\r\n#\r\n'
    expect(fillTemplate(crlf, 'X', 'Y')).toBe(
      '---\r\nid: X\r\nstatus: todo\r\ncreated: Y\r\n---\r\n\r\n#\r\n'
    )
  })

  it('必要な行がなければエラーにする', () => {
    expect(() => fillTemplate('# frontmatter なし\n', 'X', 'Y')).toThrow(/frontmatter/)
    expect(() => fillTemplate('---\nid:\n---\n', 'X', 'Y')).toThrow(/created/)
  })
})

describe('listTickets', () => {
  const today = '2026-10-18'

  it('未完了を期限の近い順、同じ期限は優先度の高い順に並べる。期限なしは最後', () => {
    const tickets = [
      ticket({ id: 'a', due: null, priority: 1 }),
      ticket({ id: 'b', due: '2026-10-25', priority: 3 }),
      ticket({ id: 'c', due: '2026-10-20', priority: 2 }),
      ticket({ id: 'd', due: '2026-10-25', priority: 1 }),
      ticket({ id: 'e', due: '2026-10-19', status: 'done' }),
      ticket({ id: 'f', due: '2026-10-25' }) // priority が空なら 2 として扱う
    ]
    expect(listTickets(tickets, DEFAULT_FILTER, today).map((t) => t.id)).toEqual([
      'c',
      'd',
      'f',
      'b',
      'a'
    ])
  })

  it('「完了も表示」なら完了も並べる', () => {
    const tickets = [
      ticket({ id: 'open', due: '2026-10-20' }),
      ticket({ id: 'closed', due: '2026-10-19', status: 'done' })
    ]
    expect(listTickets(tickets, DEFAULT_FILTER, today).map((t) => t.id)).toEqual(['open'])
    expect(
      listTickets(tickets, { ...DEFAULT_FILTER, showDone: true }, today).map((t) => t.id)
    ).toEqual(['closed', 'open'])
  })

  it('start が未来のものは既定で隠す', () => {
    const tickets = [
      ticket({ id: 'past', start: '2026-10-17' }),
      ticket({ id: 'today', start: today }),
      ticket({ id: 'future', start: '2026-10-19' })
    ]
    expect(listTickets(tickets, DEFAULT_FILTER, today).map((t) => t.id)).toEqual(['past', 'today'])
    const all = listTickets(tickets, { ...DEFAULT_FILTER, showFutureStart: true }, today)
    expect(all.map((t) => t.id)).toContain('future')
  })

  it('状態・タグ・優先度で絞り込む', () => {
    const tickets = [
      ticket({ id: 'a', status: 'doing', tags: ['仕事'], priority: 1 }),
      ticket({ id: 'b', status: 'waiting', tags: ['家'], priority: 3 }),
      ticket({ id: 'c', status: 'todo', tags: ['仕事', '家'] })
    ]
    const ids = (f: Partial<typeof DEFAULT_FILTER>): (string | null)[] =>
      listTickets(tickets, { ...DEFAULT_FILTER, ...f }, today).map((t) => t.id)
    expect(ids({ statuses: ['doing', 'waiting'] })).toEqual(['a', 'b'])
    expect(ids({ tags: ['家'] })).toEqual(['c', 'b'])
    expect(ids({ priorities: [2] })).toEqual(['c'])
  })

  describe('並べ替えを選ぶ', () => {
    const ids = (tickets: Ticket[], sort: ListSort): (string | null)[] =>
      listTickets(tickets, { ...DEFAULT_FILTER, showDone: true }, today, sort).map((t) => t.id)

    it('既定は今までと同じ（期限の近い順）', () => {
      const tickets = [
        ticket({ id: 'a', due: null }),
        ticket({ id: 'b', due: '2026-10-25' }),
        ticket({ id: 'c', due: '2026-10-20' })
      ]
      expect(ids(tickets, DEFAULT_SORT)).toEqual(['c', 'b', 'a'])
    })

    it('降順にしても、値のないものは最後に置く', () => {
      const tickets = [
        ticket({ id: 'a', due: null }),
        ticket({ id: 'b', due: '2026-10-25' }),
        ticket({ id: 'c', due: '2026-10-20' })
      ]
      expect(ids(tickets, { key: 'due', direction: 'desc' })).toEqual(['b', 'c', 'a'])
    })

    it('着手日・優先度・状態・タイトルで並べる', () => {
      const tickets = [
        ticket({ id: 'a', start: '2026-10-10', priority: 3, status: 'waiting', title: 'いちご' }),
        ticket({ id: 'b', start: null, priority: 1, status: 'done', title: '' }),
        ticket({ id: 'c', start: '2026-10-01', priority: null, status: 'todo', title: 'あめ' })
      ]
      expect(ids(tickets, { key: 'start', direction: 'asc' })).toEqual(['c', 'a', 'b'])
      expect(ids(tickets, { key: 'priority', direction: 'asc' })).toEqual(['b', 'c', 'a'])
      expect(ids(tickets, { key: 'priority', direction: 'desc' })).toEqual(['a', 'c', 'b'])
      expect(ids(tickets, { key: 'status', direction: 'asc' })).toEqual(['c', 'a', 'b'])
      expect(ids(tickets, { key: 'title', direction: 'asc' })).toEqual(['c', 'a', 'b'])
    })

    it('作成日は、同じ日なら ID の時刻の順に並べる', () => {
      const tickets = [
        ticket({ id: '20261018-1500-aaaa', created: '2026-10-18' }),
        ticket({ id: '20261017-0900-bbbb', created: '2026-10-17' }),
        ticket({ id: '20261018-0800-cccc', created: '2026-10-18' }),
        ticket({ id: '20261016-0800-dddd', created: null })
      ]
      expect(ids(tickets, { key: 'created', direction: 'desc' })).toEqual([
        '20261018-1500-aaaa',
        '20261018-0800-cccc',
        '20261017-0900-bbbb',
        '20261016-0800-dddd'
      ])
    })

    it('更新日時で並べる（読めていないものは最後）', () => {
      const tickets = [
        ticket({ id: 'a', modified: 1000 }),
        ticket({ id: 'b', modified: null }),
        ticket({ id: 'c', modified: 3000 })
      ]
      expect(ids(tickets, { key: 'modified', direction: 'desc' })).toEqual(['c', 'a', 'b'])
    })

    it('同じ値どうしは、期限・優先度の順に並べる', () => {
      const tickets = [
        ticket({ id: 'a', status: 'todo', due: '2026-10-25' }),
        ticket({ id: 'b', status: 'todo', due: '2026-10-20' })
      ]
      expect(ids(tickets, { key: 'status', direction: 'desc' })).toEqual(['b', 'a'])
    })

    it('設定の値を確かめる', () => {
      expect(asListSort({ key: 'title', direction: 'desc' })).toEqual({
        key: 'title',
        direction: 'desc'
      })
      expect(asListSort({ key: 'size', direction: 'asc' })).toBeNull()
      expect(asListSort({ key: 'due', direction: 'up' })).toBeNull()
      expect(asListSort('due')).toBeNull()
      expect(asListSort(null)).toBeNull()
    })
  })

  it('担当者で絞り込む（未割り当ても選べる）', () => {
    const tickets = [
      ticket({ id: 'a', assignee: ['山田'] }),
      ticket({ id: 'b', assignee: ['佐藤'] }),
      ticket({ id: 'c', assignee: [] }),
      ticket({ id: 'd', assignee: ['佐藤', '山田'] })
    ]
    const ids = (assignees: string[]): (string | null)[] =>
      listTickets(tickets, { ...DEFAULT_FILTER, assignees }, today).map((t) => t.id)
    // 選んだ人のどれかが担当に入っていれば出す
    expect(ids(['山田'])).toEqual(['a', 'd'])
    expect(ids(['山田', UNASSIGNED])).toEqual(['a', 'c', 'd'])
    expect(ids([])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('担当者は1人なら文字列、2人以上ならリストで読む', () => {
    expect(parseTicket('a.md', '---\nid: a\nassignee: 山田\n---\n').assignee).toEqual(['山田'])
    expect(parseTicket('a.md', '---\nid: a\nassignee: [山田, 佐藤]\n---\n').assignee).toEqual([
      '山田',
      '佐藤'
    ])
    expect(parseTicket('a.md', '---\nid: a\nassignee:\n---\n').assignee).toEqual([])
  })

  it('作成者を読み取る（行がない古いチケットは空）', () => {
    expect(parseTicket('a.md', '---\nid: a\nauthor: 山田\n---\n').author).toBe('山田')
    expect(parseTicket('a.md', '---\nid: a\n---\n').author).toBeNull()
  })

  it('タグを重複なしで集める', () => {
    const tickets = [
      ticket({ id: 'a', tags: ['仕事', 'A社'] }),
      ticket({ id: 'b', tags: ['仕事'] })
    ]
    expect(collectTags(tickets)).toEqual(['A社', '仕事'])
  })

  it('担当者の名前を重複なしで集める（空は除く）', () => {
    const tickets = [
      ticket({ id: 'a', assignee: ['山田'] }),
      ticket({ id: 'b', assignee: [] }),
      ticket({ id: 'c', assignee: ['佐藤', '田中'] }),
      ticket({ id: 'd', assignee: ['山田'] })
    ]
    expect(collectAssignees(tickets)).toEqual(['佐藤', '山田', '田中'])
  })
})

describe('findWarnings', () => {
  const kinds = (tickets: Ticket[]): string[] => findWarnings(tickets).map((w) => w.kind)

  it('問題がなければ警告なし', () => {
    expect(kinds([ticket({ id: '20261018-1356-aaaa' })])).toEqual([])
  })

  it('IDで始まらないファイル名（競合コピー）を見つける', () => {
    const t = ticket({ id: '20261018-1356-aaaa', fileName: '見積書 (1).md', fileId: null })
    expect(kinds([t])).toEqual(['not-id-filename'])
  })

  it('ファイル名と frontmatter の id の食い違いを見つける', () => {
    const t = ticket({ id: '20261018-1356-aaaa', fileId: '20261018-1356-bbbb' })
    expect(kinds([t])).toEqual(['id-mismatch'])
  })

  it('同じ id のファイルが複数あれば警告する', () => {
    const a = ticket({ id: '20261018-1356-aaaa' })
    const b = ticket({ id: '20261018-1356-aaaa', fileName: '20261018-1356-aaaa_copy.md' })
    const warnings = findWarnings([a, b])
    expect(warnings.map((w) => w.kind)).toEqual(['duplicate-id'])
    expect(warnings[0].fileNames).toHaveLength(2)
  })

  it('着手日が期限より後なら警告する', () => {
    expect(kinds([ticket({ id: 'a', start: '2026-10-20', due: '2026-10-18' })])).toEqual([
      'start-after-due'
    ])
    expect(kinds([ticket({ id: 'a', start: '2026-10-18', due: '2026-10-18' })])).toEqual([])
  })

  it('親が見つからない子を警告する', () => {
    expect(kinds([ticket({ id: 'c', parent: 'nothing' })])).toContain('missing-parent')
  })

  it('親子の循環を1つの警告にまとめる', () => {
    const tickets = [
      ticket({ id: 'a', parent: 'b' }),
      ticket({ id: 'b', parent: 'a' }),
      ticket({ id: 'c', parent: 'a' }) // 循環に入っていない子は警告しない
    ]
    const cycles = findWarnings(tickets).filter((w) => w.kind === 'parent-cycle')
    expect(cycles).toHaveLength(1)
    expect(cycles[0].fileNames.sort()).toEqual(['a.md', 'b.md'])
  })

  it('自分自身を親にしていても循環として警告する', () => {
    expect(kinds([ticket({ id: 'a', parent: 'a' })])).toContain('parent-cycle')
  })
})
