import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildNextTicket,
  describeRepeat,
  findExistingNext,
  formatRepeat,
  nextOccurrence,
  nextSchedule,
  parseRepeat
} from './repeat'
import { parseTicket, type Ticket } from './ticket'

const template = readFileSync(resolve(__dirname, '../../templates/TEMPLATE.md'), 'utf8')

function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    fileName: `${partial.id}.md`,
    archived: false,
    fileId: partial.id,
    title: '見積書を送る',
    status: 'done',
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

/** 書式を読んで、anchor の次の日付を返す */
function next(repeat: string, anchor: string, completedOn = anchor): string {
  const rule = parseRepeat(repeat)
  if (!rule) throw new Error(`${repeat} を読めません`)
  return nextOccurrence(rule, anchor, completedOn)
}

describe('parseRepeat / formatRepeat', () => {
  it.each([
    'daily',
    'weekdays',
    'weekly:mon',
    'weekly:mon,thu',
    'monthly:25',
    'monthly:end',
    'monthly:2tue',
    'monthly:lastfri',
    'yearly:12-25',
    'yearly:02-29',
    'every:2d',
    'every:2w',
    'every:3m',
    'after:7d',
    'after:2w',
    'after:1m'
  ])('%s は読んで書き戻すと同じになる', (value) => {
    expect(formatRepeat(parseRepeat(value)!)).toBe(value)
  })

  it.each([
    '',
    'weekly',
    'weekly:mo',
    'weekly:mon,mon',
    'weekly:mon,',
    'monthly:0',
    'monthly:32',
    'monthly:5tue',
    'monthly:2xyz',
    'yearly:13-01',
    'yearly:02-30',
    'yearly:2-3',
    'every:2',
    'every:1000d',
    'after:7',
    'after:0d',
    'every',
    'weekly:mon:thu'
  ])('%s は読めない', (value) => {
    expect(parseRepeat(value)).toBeNull()
  })

  it('曜日は小さい順に並べ直して書く', () => {
    expect(formatRepeat(parseRepeat('weekly:thu,mon')!)).toBe('weekly:mon,thu')
  })

  it('日本語で表す', () => {
    const describe = (v: string): string => describeRepeat(parseRepeat(v)!)
    expect(describe('weekdays')).toBe('平日（月〜金）')
    expect(describe('weekly:mon,thu')).toBe('毎週月・木曜')
    expect(describe('monthly:2tue')).toBe('毎月第2火曜')
    expect(describe('monthly:lastfri')).toBe('毎月最終金曜')
    expect(describe('yearly:12-25')).toBe('毎年12月25日')
    expect(describe('every:2w')).toBe('2週ごと')
    expect(describe('after:2w')).toBe('完了から2週間後')
    expect(describe('after:3m')).toBe('完了から3か月後')
  })

  it('大文字や前後の空白は許す', () => {
    expect(parseRepeat(' Weekly:MON ')).toEqual({ kind: 'weekly', days: [1] })
  })
})

describe('nextOccurrence', () => {
  it('毎日・毎週', () => {
    expect(next('daily', '2026-12-31')).toBe('2027-01-01')
    // 2026-10-19 は月曜
    expect(next('weekly:mon', '2026-10-19')).toBe('2026-10-26')
    expect(next('weekly:fri', '2026-10-19')).toBe('2026-10-23')
  })

  it('毎月の日付。月にない日は月末にする', () => {
    expect(next('monthly:25', '2026-10-25')).toBe('2026-11-25')
    expect(next('monthly:25', '2026-10-10')).toBe('2026-10-25')
    expect(next('monthly:31', '2026-01-31')).toBe('2026-02-28')
    expect(next('monthly:31', '2028-01-31')).toBe('2028-02-29') // うるう年
    expect(next('monthly:31', '2026-02-28')).toBe('2026-03-31')
  })

  it('毎月末', () => {
    expect(next('monthly:end', '2026-10-31')).toBe('2026-11-30')
    expect(next('monthly:end', '2026-10-15')).toBe('2026-10-31')
    expect(next('monthly:end', '2027-01-31')).toBe('2027-02-28')
    expect(next('monthly:end', '2027-12-31')).toBe('2028-01-31')
  })

  it('平日・複数の曜日', () => {
    // 2026-10-23 は金曜
    expect(next('weekdays', '2026-10-23')).toBe('2026-10-26')
    expect(next('weekdays', '2026-10-24')).toBe('2026-10-26')
    expect(next('weekdays', '2026-10-26')).toBe('2026-10-27')
    expect(next('weekly:mon,thu', '2026-10-19')).toBe('2026-10-22')
    expect(next('weekly:mon,thu', '2026-10-22')).toBe('2026-10-26')
  })

  it('毎月第n曜日・最終曜日', () => {
    // 2026年10月の第2火曜は13日、11月は10日
    expect(next('monthly:2tue', '2026-10-01')).toBe('2026-10-13')
    expect(next('monthly:2tue', '2026-10-13')).toBe('2026-11-10')
    // 2026年10月の最終金曜は30日、11月は27日
    expect(next('monthly:lastfri', '2026-10-30')).toBe('2026-11-27')
    expect(next('monthly:lastfri', '2026-12-31')).toBe('2027-01-29')
    // 第4曜日はどの月にもある
    expect(next('monthly:4sun', '2027-01-31')).toBe('2027-02-28')
  })

  it('毎年。2月29日はうるう年でない年は28日にする', () => {
    expect(next('yearly:12-25', '2026-12-25')).toBe('2027-12-25')
    expect(next('yearly:12-25', '2026-10-19')).toBe('2026-12-25')
    expect(next('yearly:02-29', '2028-02-29')).toBe('2029-02-28')
    expect(next('yearly:02-29', '2031-03-01')).toBe('2032-02-29')
  })

  it('n 日・週・か月ごと（元の予定から数える）', () => {
    expect(next('every:3d', '2026-10-30', '2026-11-10')).toBe('2026-11-02')
    expect(next('every:2w', '2026-10-19')).toBe('2026-11-02')
    expect(next('every:2m', '2026-12-31')).toBe('2027-02-28')
  })

  it('完了が遅れても、after: 以外は元の予定から数える', () => {
    expect(next('weekly:mon', '2026-10-19', '2026-10-28')).toBe('2026-10-26')
    expect(next('after:7d', '2026-10-19', '2026-10-28')).toBe('2026-11-04')
    expect(next('after:2w', '2026-10-19', '2026-10-28')).toBe('2026-11-11')
    expect(next('after:1m', '2026-10-19', '2027-01-31')).toBe('2027-02-28')
  })
})

describe('nextSchedule', () => {
  it('着手日があれば着手日を進め、期限は着手日からの日数を保つ', () => {
    // 毎月最終木曜に始めて、2日目（金曜）が期限の作業。10月の最終木曜は29日、11月は26日
    const t = ticket({
      id: 'a',
      repeat: 'monthly:lastthu',
      start: '2026-10-29',
      due: '2026-10-30'
    })
    expect(nextSchedule(t, '2026-10-30')).toEqual({ start: '2026-11-26', due: '2026-11-27' })
  })

  it('着手日がなければ期限を進める', () => {
    const t = ticket({ id: 'a', repeat: 'weekly:fri', due: '2026-10-23' })
    expect(nextSchedule(t, '2026-10-23')).toEqual({ due: '2026-10-30', start: null })
  })

  it('着手日だけなら着手日を進め、日付がなければ完了した日から数える', () => {
    expect(
      nextSchedule(ticket({ id: 'a', repeat: 'daily', start: '2026-10-19' }), '2026-10-20')
    ).toEqual({
      due: null,
      start: '2026-10-20'
    })
    expect(nextSchedule(ticket({ id: 'a', repeat: 'daily' }), '2026-10-20')).toEqual({
      due: '2026-10-21',
      start: null
    })
  })

  it('repeat がない・読めないときは null', () => {
    expect(nextSchedule(ticket({ id: 'a' }), '2026-10-20')).toBeNull()
    expect(nextSchedule(ticket({ id: 'a', repeat: 'sometimes' }), '2026-10-20')).toBeNull()
  })
})

describe('findExistingNext', () => {
  it('タイトル・繰り返し・親・日付が同じチケットを、作成済みの次回分とみなす', () => {
    const done = ticket({ id: 'a', repeat: 'daily', due: '2026-10-19' })
    const plan = { due: '2026-10-20', start: null }
    const same = ticket({ id: 'b', status: 'todo', repeat: 'daily', due: '2026-10-20' })
    const other = ticket({ id: 'c', status: 'todo', repeat: 'daily', due: '2026-10-21' })
    expect(findExistingNext(done, plan, [done, other])).toBeNull()
    expect(findExistingNext(done, plan, [done, other, same])?.id).toBe('b')
  })
})

describe('buildNextTicket', () => {
  it('タイトルに $ があっても、そのまま引き継ぐ', () => {
    for (const title of ['$$ 支払い', '見積$&', '$1 と $`']) {
      const done = parseTicket(
        '20261019-0900-aaaa.md',
        `---\nid: 20261019-0900-aaaa\nstatus: done\nrepeat: daily\n---\n\n# ${title}\n`
      )
      const text = buildNextTicket(
        template,
        '20261020-0900-bbbb',
        '2026-10-20',
        done,
        { due: '2026-10-21', start: null },
        ''
      )
      expect(text.endsWith(`\n# ${title}\n`)).toBe(true)
    }
  })

  it('引き継ぐ項目を入れ、本文のメモは引き継がない', () => {
    const done = parseTicket(
      '20261019-0900-aaaa.md',
      [
        '---',
        'id: 20261019-0900-aaaa',
        'status: done',
        'priority: 1',
        'start: 2026-10-21',
        'due: 2026-10-23',
        'repeat: weekly:fri',
        'tags: [仕事, A社]',
        'parent: 20261001-0900-pa01',
        'assignee: 佐藤',
        'author: 鈴木',
        'created: 2026-10-19',
        'done: 2026-10-23',
        '---',
        '',
        '# 週報を送る',
        '',
        '- 今週のメモ',
        ''
      ].join('\n')
    )
    const text = buildNextTicket(
      template,
      '20261023-1800-bbbb',
      '2026-10-23',
      done,
      { due: '2026-10-30', start: '2026-10-28' },
      '山田'
    )
    expect(text).toBe(
      [
        '---',
        'id: 20261023-1800-bbbb',
        'status: todo',
        'priority: 1',
        'start: 2026-10-28',
        'due: 2026-10-30',
        'repeat: weekly:fri',
        'tags: [仕事, A社]',
        'parent: 20261001-0900-pa01',
        'source:',
        'assignee: 佐藤',
        'author: 山田',
        'created: 2026-10-23',
        'done:',
        '---',
        '',
        '# 週報を送る',
        ''
      ].join('\n')
    )
  })
})
