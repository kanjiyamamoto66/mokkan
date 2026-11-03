import { describe, expect, it } from 'vitest'
import { addDays, calendarItems, ganttRows, ticketSpan, validDate, type GanttRow } from './schedule'
import { DEFAULT_FILTER, type Ticket } from './ticket'

function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    fileName: `${partial.id}.md`,
    archived: false,
    fileId: partial.id,
    title: partial.id,
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

/** テストで見やすいよう、行を「字下げ＋id＋種類＋期間」の文字列にする */
function outline(rows: GanttRow[]): string[] {
  return rows.map(
    (r) =>
      `${'  '.repeat(r.depth)}${r.fileName?.replace(/\.md$/, '') ?? r.title} ${r.kind}` +
      (r.start ? ` ${r.start}~${r.end}` : '') +
      (r.faded ? ' (薄)' : '') +
      (r.warning ? ' ⚠' : '')
  )
}

describe('日付', () => {
  it('正しい YYYY-MM-DD だけを日付とみなす', () => {
    expect(validDate('2026-10-18')).toBe('2026-10-18')
    expect(validDate('2026-02-30')).toBeNull()
    expect(validDate('2026/10/18')).toBeNull()
    expect(validDate(null)).toBeNull()
  })

  it('日数を足す（月や年をまたいでも）', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('期間：start〜due。片方だけならその1日。start が due より後なら due の1日', () => {
    expect(ticketSpan(ticket({ id: 'a', start: '2026-10-01', due: '2026-10-05' }))).toEqual({
      start: '2026-10-01',
      end: '2026-10-05'
    })
    expect(ticketSpan(ticket({ id: 'a', due: '2026-10-05' }))).toEqual({
      start: '2026-10-05',
      end: '2026-10-05'
    })
    expect(ticketSpan(ticket({ id: 'a', start: '2026-10-09', due: '2026-10-05' }))).toEqual({
      start: '2026-10-05',
      end: '2026-10-05'
    })
    expect(ticketSpan(ticket({ id: 'a' }))).toBeNull()
  })
})

describe('calendarItems', () => {
  const today = '2026-10-18'

  it('due の日に置き、start があれば帯にする。日付のないものと完了は出さない', () => {
    const items = calendarItems(
      [
        ticket({ id: 'a', due: '2026-10-20' }),
        ticket({ id: 'b', start: '2026-10-19', due: '2026-10-22' }),
        ticket({ id: 'c' }),
        ticket({ id: 'd', due: '2026-10-21', status: 'done' }),
        ticket({ id: 'e', due: '2026-10-10' })
      ],
      DEFAULT_FILTER,
      today
    )
    expect(items.map((i) => [i.fileName, i.start, i.end, i.overdue])).toEqual([
      ['a.md', '2026-10-20', '2026-10-20', false],
      ['b.md', '2026-10-19', '2026-10-22', false],
      ['e.md', '2026-10-10', '2026-10-10', true]
    ])
  })

  it('「完了も表示」なら完了も出す（期限切れの印は付けない）', () => {
    const items = calendarItems(
      [ticket({ id: 'd', due: '2026-10-01', status: 'done' })],
      { ...DEFAULT_FILTER, showDone: true },
      today
    )
    expect(items.map((i) => [i.fileName, i.overdue])).toEqual([['d.md', false]])
  })

  it('祖先のタイトルを一番上から順に持つ（日付のない親や、絞り込みで隠れた親も含める）', () => {
    const items = calendarItems(
      [
        ticket({ id: 'root', title: '引っ越し', status: 'done' }),
        ticket({ id: 'mid', title: '', parent: 'root' }),
        ticket({ id: 'leaf', title: '見積もり', parent: 'mid', due: '2026-10-20' }),
        ticket({ id: 'solo', due: '2026-10-21' }),
        ticket({ id: 'orphan', parent: 'none', due: '2026-10-22' })
      ],
      DEFAULT_FILTER,
      today
    )
    expect(items.map((i) => [i.fileName, i.path])).toEqual([
      ['leaf.md', ['引っ越し', '（タイトルなし）']],
      ['solo.md', []],
      ['orphan.md', []]
    ])
  })

  it('左の線の色に使う、最初のタグを持つ（タグのないものは null）', () => {
    const items = calendarItems(
      [
        ticket({ id: 'a', due: '2026-10-25', tags: ['仕事', 'A社'] }),
        ticket({ id: 'b', due: '2026-10-21' })
      ],
      DEFAULT_FILTER,
      today
    )
    expect(items.map((i) => [i.fileName, i.tag])).toEqual([
      ['a.md', '仕事'],
      ['b.md', null]
    ])
  })

  it('並び順：親子のまとまりの中では、期間が長い子やタイトルが先の子より親を上にする', () => {
    const items = calendarItems(
      [
        ticket({ id: 'p', title: 'す 親', due: '2026-10-20' }),
        // 期間が長い子（既定の順なら親より上にくる）
        ticket({ id: 'c1', title: 'う 子1', parent: 'p', start: '2026-10-18', due: '2026-10-22' }),
        // タイトルが先の子
        ticket({ id: 'c2', title: 'あ 子2', parent: 'p', due: '2026-10-20' }),
        ticket({ id: 'g', title: 'い 孫', parent: 'c1', due: '2026-10-20' }),
        // まとまりの外のチケットは、既定の順（始まりが早い→期間が長い→タイトル）のまま
        ticket({ id: 'x', title: 'か 他', due: '2026-10-20' }),
        ticket({ id: 'y', title: 'お 他', start: '2026-10-19', due: '2026-10-20' })
      ],
      DEFAULT_FILTER,
      today
    )
    const byOrder = [...items].sort((a, b) => a.order - b.order).map((i) => i.fileName)
    expect(byOrder).toEqual(['p.md', 'c1.md', 'g.md', 'c2.md', 'y.md', 'x.md'])
  })

  it('親子が循環していたら経路は出さない', () => {
    const items = calendarItems(
      [
        ticket({ id: 'a', parent: 'b', due: '2026-10-20' }),
        ticket({ id: 'b', parent: 'a', due: '2026-10-21' })
      ],
      DEFAULT_FILTER,
      today
    )
    expect(items.map((i) => i.path)).toEqual([[], []])
  })
})

describe('ganttRows の状態と期限切れ', () => {
  it('まとめ棒の状態は親自身の状態（子がすべて完了しても、親が未完了なら完了にしない）', () => {
    const rows = ganttRows(
      [
        ticket({ id: 'p', status: 'doing', due: '2026-10-25' }),
        ticket({ id: 'c', parent: 'p', status: 'done', due: '2026-10-20' })
      ],
      { ...DEFAULT_FILTER, showDone: true },
      'parent'
    )
    expect(rows.map((r) => [r.fileName, r.kind, r.status])).toEqual([
      ['p.md', 'summary', 'doing'],
      ['c.md', 'milestone', 'done']
    ])
  })

  it('today を渡すと、期限を過ぎた未完了の行に期限切れの印を付ける', () => {
    const tickets = [
      ticket({ id: 'late', due: '2026-10-10' }),
      ticket({ id: 'doneLate', due: '2026-10-10', status: 'done' }),
      ticket({ id: 'future', due: '2026-10-30' })
    ]
    const filter = { ...DEFAULT_FILTER, showDone: true }
    expect(
      ganttRows(tickets, filter, 'parent', '2026-10-18').map((r) => [r.fileName, r.overdue])
    ).toEqual([
      ['doneLate.md', false],
      ['late.md', true],
      ['future.md', false]
    ])
    expect(ganttRows(tickets, filter, 'parent').every((r) => !r.overdue)).toBe(true)
  })
})

describe('ganttRows（親ごと）', () => {
  const family = [
    ticket({ id: 'p', due: '2026-10-25' }),
    ticket({ id: 'c1', parent: 'p', start: '2026-10-19', due: '2026-10-22' }),
    ticket({ id: 'c2', parent: 'p', start: '2026-10-21', due: '2026-10-28', tags: ['仕事'] }),
    ticket({ id: 'g1', parent: 'c2', due: '2026-10-27' }),
    ticket({ id: 'solo' })
  ]

  it('親→子→孫の順に並べ、親は子孫全体の期間のまとめ棒にする', () => {
    expect(outline(ganttRows(family, DEFAULT_FILTER, 'parent'))).toEqual([
      'p summary 2026-10-19~2026-10-28 ⚠',
      '  c1 task 2026-10-19~2026-10-22',
      '  c2 summary 2026-10-21~2026-10-28',
      '    g1 milestone 2026-10-27~2026-10-27',
      'solo nodate'
    ])
  })

  it('親の期限を子孫がはみ出したら警告を付ける', () => {
    const p = ganttRows(family, DEFAULT_FILTER, 'parent')[0]
    expect(p.warning).toContain('2026-10-25')
    expect(p.warning).toContain('2026-10-28')
  })

  it('最初は一番上だけ開く（2段目まで見える）', () => {
    const open = ganttRows(family, DEFAULT_FILTER, 'parent').map((r) => [r.fileName, r.open])
    expect(open).toEqual([
      ['p.md', true],
      ['c1.md', false],
      ['c2.md', false],
      ['g1.md', false],
      ['solo.md', false]
    ])
  })

  it('深い階層には、祖先のタイトルの経路を持たせる', () => {
    const g1 = ganttRows(family, DEFAULT_FILTER, 'parent').find((r) => r.fileName === 'g1.md')!
    expect(g1.path).toEqual(['p', 'c2'])
    expect(g1.depth).toBe(2)
  })

  it('絞り込んだときは、条件に合う子孫の祖先を薄く表示する', () => {
    const rows = ganttRows(family, { ...DEFAULT_FILTER, tags: ['仕事'] }, 'parent')
    expect(outline(rows)).toEqual([
      'p summary 2026-10-19~2026-10-28 (薄) ⚠',
      '  c2 task 2026-10-21~2026-10-28'
    ])
  })

  it('完了した子は隠すが、まとめ棒の期間には含める', () => {
    const rows = ganttRows(
      [
        ticket({ id: 'p' }),
        ticket({ id: 'done', parent: 'p', due: '2026-10-30', status: 'done' }),
        ticket({ id: 'open', parent: 'p', due: '2026-10-20' })
      ],
      DEFAULT_FILTER,
      'parent'
    )
    expect(outline(rows)).toEqual([
      'p summary 2026-10-20~2026-10-30',
      '  open milestone 2026-10-20~2026-10-20'
    ])
  })

  it('親が見つからない子と、循環した親子は一番上に置く', () => {
    const rows = ganttRows(
      [
        ticket({ id: 'orphan', parent: 'nothing' }),
        ticket({ id: 'a', parent: 'b' }),
        ticket({ id: 'b', parent: 'a' }),
        ticket({ id: 'self', parent: 'self' })
      ],
      DEFAULT_FILTER,
      'parent'
    )
    expect(rows.every((r) => r.depth === 0 && r.parentKey === null)).toBe(true)
    expect(rows).toHaveLength(4)
  })

  it('同じ親の子は、始まりの早い順に並べる（日付のないものは最後）', () => {
    const rows = ganttRows(
      [
        ticket({ id: 'p' }),
        ticket({ id: 'x', parent: 'p' }),
        ticket({ id: 'late', parent: 'p', due: '2026-10-30' }),
        ticket({ id: 'early', parent: 'p', start: '2026-10-01', due: '2026-10-31' })
      ],
      DEFAULT_FILTER,
      'parent'
    )
    expect(rows.map((r) => r.fileName)).toEqual(['p.md', 'early.md', 'late.md', 'x.md'])
  })
})

describe('ganttRows（タグごと）', () => {
  it('タグごとに見出し行でまとめ、複数のタグを持つチケットはそれぞれに出す', () => {
    const rows = ganttRows(
      [
        ticket({ id: 'a', tags: ['仕事', 'A社'], due: '2026-10-20' }),
        ticket({ id: 'b', tags: ['仕事'], start: '2026-10-18', due: '2026-10-25' }),
        ticket({ id: 'c' })
      ],
      DEFAULT_FILTER,
      'tag'
    )
    expect(outline(rows)).toEqual([
      'A社 group 2026-10-20~2026-10-20',
      '  a milestone 2026-10-20~2026-10-20',
      '仕事 group 2026-10-18~2026-10-25',
      '  b task 2026-10-18~2026-10-25',
      '  a milestone 2026-10-20~2026-10-20',
      'タグなし nodate',
      '  c nodate'
    ])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})
