import { describe, expect, it } from 'vitest'
import {
  applyDayEdit,
  busyMinutes,
  dateOfDayFile,
  dayCandidates,
  dayEditError,
  durationLabel,
  entryLine,
  formatDuration,
  formatTime,
  layoutColumns,
  linkOf,
  missingRoutine,
  newDayText,
  otherTickets,
  parseDay,
  parseDuration,
  parseRoutine,
  parseTime,
  routineFor,
  routineWorkHours,
  setRoutineWorkHours
} from './day'
import { parseTicket, type Ticket } from './ticket'

const DAY = `---
date: 2026-11-24
---

- 09:00-09:30 メールの確認
- 10:00-11:00 [定例MTG](../notes/案件A/20261124-1000-mt01_定例MTG.md)
メモ：午後は外出
- 11:00-12:30 [見積を作る](../tickets/20261124-1000-abcd_見積を作る.md) 続き
- 10:00 時刻が1つだけ
- 13:00-12:00 終わりが先
`

describe('時刻と所要時間', () => {
  it('時刻を読み書きする', () => {
    expect(parseTime('09:05')).toBe(545)
    expect(parseTime('9:00')).toBe(540)
    expect(parseTime('24:00')).toBe(1440)
    expect(parseTime('24:30')).toBeNull()
    expect(parseTime('10:60')).toBeNull()
    expect(parseTime('1000')).toBeNull()
    expect(formatTime(545)).toBe('09:05')
  })

  it('所要時間を読み書きする', () => {
    expect(parseDuration('30m')).toBe(30)
    expect(parseDuration('1h')).toBe(60)
    expect(parseDuration('1h30m')).toBe(90)
    expect(parseDuration('90m')).toBe(90)
    expect(parseDuration(' 2H ')).toBe(120)
    expect(parseDuration('0m')).toBeNull()
    expect(parseDuration('25h')).toBeNull()
    expect(parseDuration('1.5h')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(formatDuration(90)).toBe('1h30m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(45)).toBe('45m')
    expect(durationLabel(90)).toBe('1時間30分')
  })

  it('日のファイル名から日付を読む', () => {
    expect(dateOfDayFile('2026-11-24.md')).toBe('2026-11-24')
    expect(dateOfDayFile('2026-02-30.md')).toBeNull()
    expect(dateOfDayFile('routine.md')).toBeNull()
  })
})

describe('日のファイルを読む', () => {
  it('決まった形の行だけを読み、崩れた行は読めない行にする。ほかの行は読まない', () => {
    const { entries, broken } = parseDay(DAY)
    expect(entries.map((e) => [e.line, e.start, e.end, e.content])).toEqual([
      [4, 540, 570, 'メールの確認'],
      [5, 600, 660, '[定例MTG](../notes/案件A/20261124-1000-mt01_定例MTG.md)'],
      [7, 660, 750, '[見積を作る](../tickets/20261124-1000-abcd_見積を作る.md) 続き']
    ])
    expect(entries[1].href).toBe('../notes/案件A/20261124-1000-mt01_定例MTG.md')
    expect(entries[1].label).toBe('定例MTG')
    expect(broken.map((b) => b.line)).toEqual([8, 9])
  })

  it('数字で始まるだけのメモの行は、読めない行にしない', () => {
    const memo =
      '---\ndate: 2026-11-24\n---\n\n- 3社に連絡\n- 2026年の目標\n- 10:00 時刻が1つだけ\n'
    expect(parseDay(memo).broken.map((b) => b.raw)).toEqual(['- 10:00 時刻が1つだけ'])
  })

  it('リンク先が <…> で囲んであっても読む', () => {
    expect(linkOf('[a b](<../tickets/x y.md>)')).toEqual({
      label: 'a b',
      href: '../tickets/x y.md'
    })
  })

  it('frontmatter の中の行は読まない', () => {
    expect(parseDay('---\nx: - 10:00-11:00 y\n---\n').entries).toEqual([])
  })
})

describe('日のファイルを書き換える', () => {
  it('足すときは時刻の順の位置に入れ、ほかの行は変えない', () => {
    const next = applyDayEdit(DAY, { kind: 'add', start: 570, end: 600, content: '移動' })!
    expect(next).toBe(DAY.replace('- 10:00-11:00', '- 09:30-10:00 移動\n- 10:00-11:00'))
    const last = applyDayEdit(DAY, { kind: 'add', start: 900, end: 960, content: '振り返り' })!
    expect(last).toBe(DAY.replace(' 続き\n', ' 続き\n- 15:00-16:00 振り返り\n'))
  })

  it('時間割の行がないファイルや、作ったばかりのファイルにも足せる', () => {
    expect(
      applyDayEdit(newDayText('2026-11-24'), { kind: 'add', start: 600, end: 660, content: 'A' })
    ).toBe('---\ndate: 2026-11-24\n---\n\n- 10:00-11:00 A\n')
    expect(
      applyDayEdit('---\ndate: 2026-11-24\n---\n', {
        kind: 'add',
        start: 600,
        end: 660,
        content: 'A'
      })
    ).toBe('---\ndate: 2026-11-24\n---\n\n- 10:00-11:00 A\n')
  })

  it('始まりが同じならその場で書き換え、変わったら時刻の順の位置に移す', () => {
    const raw = '- 09:00-09:30 メールの確認'
    expect(
      applyDayEdit(DAY, { kind: 'update', line: 4, raw, start: 540, end: 600, content: 'メール' })
    ).toBe(DAY.replace(raw, '- 09:00-10:00 メール'))
    const moved = applyDayEdit(DAY, {
      kind: 'update',
      line: 4,
      raw,
      start: 780,
      end: 810,
      content: 'メールの確認'
    })!
    expect(moved).toBe(
      DAY.replace(`${raw}\n`, '').replace(' 続き\n', ' 続き\n- 13:00-13:30 メールの確認\n')
    )
  })

  it('消すときは、その行だけを消す', () => {
    const raw = '- 09:00-09:30 メールの確認'
    expect(applyDayEdit(DAY, { kind: 'remove', line: 4, raw })).toBe(DAY.replace(`${raw}\n`, ''))
  })

  it('画面で読んだときから行が変わっていたら書き換えない', () => {
    expect(applyDayEdit(DAY, { kind: 'remove', line: 4, raw: '- 09:00-09:30 ちがう' })).toBeNull()
    expect(
      applyDayEdit(DAY, { kind: 'update', line: 99, raw: 'x', start: 1, end: 2, content: 'y' })
    ).toBeNull()
  })

  it('前の書き換えで行の位置がずれていても、同じ文字の行が1つなら、その行を書き換える', () => {
    // 先に 09:30 の行を足したので、10:00 の行は5行目から6行目にずれている
    const shifted = applyDayEdit(DAY, { kind: 'add', start: 570, end: 600, content: '移動' })!
    const raw = '- 10:00-11:00 [定例MTG](../notes/案件A/20261124-1000-mt01_定例MTG.md)'
    expect(applyDayEdit(shifted, { kind: 'remove', line: 5, raw })).toBe(
      shifted.replace(`${raw}\n`, '')
    )
  })

  it('同じ文字の行が2つ以上あって位置もずれていたら、どれか分からないので書き換えない', () => {
    const twice = DAY.replace('メモ：午後は外出', '- 09:00-09:30 メールの確認')
    expect(
      applyDayEdit(twice, { kind: 'remove', line: 2, raw: '- 09:00-09:30 メールの確認' })
    ).toBeNull()
  })

  it('touch は何も変えない（ファイルを作るためだけ）', () => {
    expect(applyDayEdit(DAY, { kind: 'touch' })).toBe(DAY)
  })

  it('CRLF のファイルは CRLF のまま書く', () => {
    const crlf = DAY.replace(/\n/g, '\r\n')
    const next = applyDayEdit(crlf, { kind: 'add', start: 570, end: 600, content: '移動' })!
    expect(next).toBe(crlf.replace('- 10:00-11:00', '- 09:30-10:00 移動\r\n- 10:00-11:00'))
  })

  it('内容の改行は空白にして1行で書く', () => {
    expect(entryLine(540, 600, 'a\nb')).toBe('- 09:00-10:00 a b')
  })

  it('おかしな書き換えを見分ける', () => {
    expect(dayEditError({ kind: 'add', start: 600, end: 600, content: 'a' })).not.toBeNull()
    expect(dayEditError({ kind: 'add', start: 600, end: 1441, content: 'a' })).not.toBeNull()
    expect(dayEditError({ kind: 'add', start: 600, end: 660, content: ' ' })).not.toBeNull()
    expect(dayEditError({ kind: 'add', start: 600.5, end: 660, content: 'a' })).not.toBeNull()
    expect(dayEditError({ kind: 'add', start: 600, end: 660, content: 'a' })).toBeNull()
  })
})

describe('いつもの予定', () => {
  const ROUTINE = `# いつもの予定

- weekly:tue 10:00-11:00 定例MTG
- weekdays 09:00-09:15 朝会
- monthly:lastfri 15:00-16:00 月次の振り返り
- every:2w@2026-11-10 13:00-14:00 隔週の1on1
- every:2w 13:00-14:00 数え始めがない
- after:7d 13:00-14:00 完了から数える規則は使えない
- weekly:xyz 10:00-11:00 読めない規則
`

  it('読める行だけを読む', () => {
    expect(parseRoutine(ROUTINE).map((r) => r.content)).toEqual([
      '定例MTG',
      '朝会',
      '月次の振り返り',
      '隔週の1on1'
    ])
  })

  it('その日に当たるものを、始まりの時刻の順に返す', () => {
    const routine = parseRoutine(ROUTINE)
    // 2026-11-24 は火曜
    expect(routineFor(routine, '2026-11-24').map((r) => r.content)).toEqual([
      '朝会',
      '定例MTG',
      '隔週の1on1'
    ])
    // 2026-11-27 は11月の最終金曜
    expect(routineFor(routine, '2026-11-27').map((r) => r.content)).toEqual([
      '朝会',
      '月次の振り返り'
    ])
    expect(routineFor(routine, '2026-11-17').map((r) => r.content)).toEqual(['朝会', '定例MTG'])
    expect(routineFor(routine, '2026-11-29')).toEqual([])
  })
})

describe('作業する時間（routine.md の work）', () => {
  it('frontmatter の work を読む。ない・読めないときは null', () => {
    expect(
      routineWorkHours('---\nwork: 09:30-18:00\n---\n\n- weekdays 09:00-09:15 朝会\n')
    ).toEqual({
      start: 570,
      end: 1080
    })
    expect(routineWorkHours('---\r\nwork: "8:00-17:00"\r\n---\r\n')).toEqual({
      start: 480,
      end: 1020
    })
    expect(routineWorkHours(null)).toBeNull()
    expect(routineWorkHours('# いつもの予定\n\nwork: 09:00-18:00\n')).toBeNull()
    expect(routineWorkHours('---\nwork: 18:00-09:00\n---\n')).toBeNull()
    expect(routineWorkHours('---\nwork: 朝から\n---\n')).toBeNull()
  })

  it('work の行だけを書き換え、ほかの行は変えない', () => {
    const hours = { start: 540, end: 1050 }
    expect(
      setRoutineWorkHours(
        '---\nwork: 09:00-18:00\nmemo: x\n---\n\n- weekdays 09:00-09:15 朝会\n',
        hours
      )
    ).toBe('---\nwork: 09:00-17:30\nmemo: x\n---\n\n- weekdays 09:00-09:15 朝会\n')
    // frontmatter に work がなければ最後に足す（改行は元のまま）
    expect(setRoutineWorkHours('---\r\nmemo: x\r\n---\r\n本文\r\n', hours)).toBe(
      '---\r\nmemo: x\r\nwork: 09:00-17:30\r\n---\r\n本文\r\n'
    )
    // frontmatter がなければ先頭に足す
    expect(setRoutineWorkHours('# いつもの予定\n', hours)).toBe(
      '---\nwork: 09:00-17:30\n---\n\n# いつもの予定\n'
    )
    // ファイルがなければ作る
    const created = setRoutineWorkHours(null, hours)
    expect(routineWorkHours(created)).toEqual(hours)
    expect(parseRoutine(created)).toEqual([])
  })
})

describe('画面に並べる', () => {
  it('重なる予定を列に分ける', () => {
    const items = [
      { id: 'a', start: 600, end: 660 },
      { id: 'b', start: 630, end: 690 },
      { id: 'c', start: 660, end: 720 },
      { id: 'd', start: 800, end: 860 }
    ]
    const placed = layoutColumns(items).map((p) => [p.item.id, p.column, p.columns])
    expect(placed).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
      ['d', 0, 1]
    ])
  })

  it('作業する時間のうち埋まっている分を、重なりを1回だけ数えて出す', () => {
    const work = { start: 540, end: 1080 }
    expect(
      busyMinutes(
        [
          { start: 480, end: 600 },
          { start: 570, end: 630 },
          { start: 1050, end: 1200 }
        ],
        work
      )
    ).toBe(90 + 30)
  })

  const ticket = (name: string, fm: string): Ticket =>
    parseTicket(
      name,
      `---\nid: ${name.slice(0, 18)}\n${fm}\ncreated: 2026-11-01\n---\n\n# ${name}\n`
    )

  it('その日の候補を、まずやるもの（期限まで・作業中）と、着手日を過ぎただけのものに分ける', () => {
    const tickets = [
      ticket('20261101-0900-aaaa', 'status: todo\ndue: 2026-11-24'),
      ticket('20261101-0900-bbbb', 'status: todo\ndue: 2026-11-30'),
      ticket('20261101-0900-cccc', 'status: doing'),
      ticket('20261101-0900-dddd', 'status: done\ndue: 2026-11-20'),
      ticket('20261101-0900-eeee', 'status: todo\nstart: 2026-11-20'),
      ticket('20261101-0900-ffff', 'status: todo\ndue: 2026-11-10'),
      ticket('20261101-0900-gggg', 'status: todo\nstart: 2026-11-01\ndue: 2026-12-10'),
      ticket('20261101-0900-hhhh', 'status: todo\nstart: 2026-11-01')
    ]
    const result = dayCandidates(tickets, '2026-11-24', new Set(['20261101-0900-eeee']))
    expect(result.focus.map((t) => t.id)).toEqual([
      '20261101-0900-ffff',
      '20261101-0900-aaaa',
      '20261101-0900-cccc'
    ])
    expect(result.started.map((t) => t.id)).toEqual(['20261101-0900-gggg', '20261101-0900-hhhh'])
  })

  it('待ちのチケットと、子チケットを持つ親は候補にしない（所要時間を二重に数えない）', () => {
    const tickets = [
      ticket('20261101-0900-wait', 'status: waiting\ndue: 2026-11-20'),
      ticket('20261101-0900-pare', 'status: doing\ndue: 2026-11-20'),
      ticket('20261101-0900-chil', 'status: todo\ndue: 2026-11-20\nparent: 20261101-0900-pare')
    ]
    expect(dayCandidates(tickets, '2026-11-24', new Set()).focus.map((t) => t.id)).toEqual([
      '20261101-0900-chil'
    ])
  })

  it('子がすべて完了した親は、親に残った作業として候補にする', () => {
    const tickets = [
      ticket('20261101-0900-pare', 'status: doing\ndue: 2026-11-20'),
      ticket('20261101-0900-chil', 'status: done\ndue: 2026-11-20\nparent: 20261101-0900-pare')
    ]
    expect(dayCandidates(tickets, '2026-11-24', new Set()).focus.map((t) => t.id)).toEqual([
      '20261101-0900-pare'
    ])
  })

  it('いつもの予定は、内容（リンクならリンクの文字）が同じ予定がファイルにあれば「ある」とみなす', () => {
    const routine = parseRoutine(
      [
        '- weekdays 09:00-09:15 朝会',
        '- weekly:tue 10:00-11:00 定例MTG',
        '- weekly:tue 13:00-14:00 1on1',
        '- weekly:tue 15:00-15:30 [週報](../notes/共通/20261101-0900-kn01_週報.md)'
      ].join('\n')
    )
    const day = parseDay(
      [
        '---',
        'date: 2026-11-24',
        '---',
        '',
        '- 9:00-9:15 朝会',
        '- 10:30-11:30 [定例MTG](../notes/案件A/20261124-1000-mt01_定例MTG.md)',
        '- 15:00-15:30  週報 ',
        ''
      ].join('\n')
    )
    expect(missingRoutine(routine, day.entries).map((r) => r.content)).toEqual(['1on1'])
  })

  it('候補のほかのチケットを、タイトルで探す（置いたもの・完了は除く）', () => {
    const tickets = [
      ticket('20261101-0900-aaaa', 'status: todo\ndue: 2026-11-24'),
      ticket('20261101-0900-bbbb', 'status: todo\ndue: 2026-12-30'),
      ticket('20261101-0900-cccc', 'status: todo'),
      ticket('20261101-0900-dddd', 'status: done')
    ]
    const candidates = dayCandidates(tickets, '2026-11-24', new Set())
    expect(otherTickets(tickets, candidates, new Set(), '').map((t) => t.id)).toEqual([
      '20261101-0900-bbbb',
      '20261101-0900-cccc'
    ])
    expect(otherTickets(tickets, candidates, new Set(), 'cccc').map((t) => t.id)).toEqual([
      '20261101-0900-cccc'
    ])
  })
})
