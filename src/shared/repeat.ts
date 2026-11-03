// 繰り返し（repeat）の書式の読み取りと、次回の日付の計算。書式は RULES.md の「繰り返し」の表と同じ
// 日付は `YYYY-MM-DD` の文字列で扱い、計算は UTC の Date で行う（時差や夏時間の影響を受けないように）

import { fillTemplate, splitFrontmatter, type Ticket } from './ticket'
import { assigneeField, setFields, replaceBody, type FieldUpdates } from './frontmatter'
import { validDate } from './schedule'

export type RepeatUnit = 'd' | 'w' | 'm'
export type NthWeek = 1 | 2 | 3 | 4 | 'last'

export type RepeatRule =
  | { kind: 'daily' }
  /** 平日（月〜金） */
  | { kind: 'weekdays' }
  /** 毎週。days は曜日（0 が日曜）を小さい順に並べたもの */
  | { kind: 'weekly'; days: number[] }
  | { kind: 'monthly-day'; day: number }
  | { kind: 'monthly-end' }
  /** 毎月第 n 曜日。n が 'last' なら最終の曜日 */
  | { kind: 'monthly-nth'; n: NthWeek; weekday: number }
  /** 毎年。month は 1〜12 */
  | { kind: 'yearly'; month: number; day: number }
  /** 元の予定から n 日・週・か月ごと */
  | { kind: 'every'; n: number; unit: RepeatUnit }
  /** 完了した日から n 日・週・か月後 */
  | { kind: 'after'; n: number; unit: RepeatUnit }

export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 間隔の上限（打ち間違いで極端な日付にならないように） */
export const MAX_INTERVAL = 999

function weekdayIndex(name: string): number | null {
  const index = WEEKDAY_NAMES.indexOf(name as (typeof WEEKDAY_NAMES)[number])
  return index >= 0 ? index : null
}

function interval(text: string): number | null {
  if (!/^\d{1,3}$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= MAX_INTERVAL ? n : null
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** repeat の値を読む。RULES.md の書式でなければ null */
export function parseRepeat(value: string | null): RepeatRule | null {
  if (value === null) return null
  const text = value.trim().toLowerCase()
  if (text === 'daily') return { kind: 'daily' }
  if (text === 'weekdays') return { kind: 'weekdays' }

  const [head, arg = '', ...rest] = text.split(':')
  if (rest.length > 0) return null
  switch (head) {
    case 'weekly': {
      const days = arg.split(',').map(weekdayIndex)
      if (days.some((d) => d === null)) return null
      const unique = [...new Set(days as number[])].sort((a, b) => a - b)
      return unique.length === days.length ? { kind: 'weekly', days: unique } : null
    }
    case 'monthly': {
      if (arg === 'end') return { kind: 'monthly-end' }
      const nth = /^([1-4]|last)([a-z]{3})$/.exec(arg)
      if (nth) {
        const weekday = weekdayIndex(nth[2])
        if (weekday === null) return null
        const n = nth[1] === 'last' ? 'last' : (Number(nth[1]) as NthWeek)
        return { kind: 'monthly-nth', n, weekday }
      }
      if (!/^\d{1,2}$/.test(arg)) return null
      const day = Number(arg)
      return day >= 1 && day <= 31 ? { kind: 'monthly-day', day } : null
    }
    case 'yearly': {
      const match = /^(\d{2})-(\d{2})$/.exec(arg)
      if (!match) return null
      const month = Number(match[1])
      const day = Number(match[2])
      // 2月29日も書ける（うるう年でない年は28日にする）
      if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2000, month - 1)) return null
      return { kind: 'yearly', month, day }
    }
    case 'every':
    case 'after': {
      const match = /^(\d+)([dwm])$/.exec(arg)
      const n = match ? interval(match[1]) : null
      return match && n ? { kind: head, n, unit: match[2] as RepeatUnit } : null
    }
    default:
      return null
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** RepeatRule を RULES.md の書式で書く */
export function formatRepeat(rule: RepeatRule): string {
  switch (rule.kind) {
    case 'daily':
      return 'daily'
    case 'weekdays':
      return 'weekdays'
    case 'weekly':
      return `weekly:${rule.days.map((d) => WEEKDAY_NAMES[d]).join(',')}`
    case 'monthly-day':
      return `monthly:${rule.day}`
    case 'monthly-end':
      return 'monthly:end'
    case 'monthly-nth':
      return `monthly:${rule.n}${WEEKDAY_NAMES[rule.weekday]}`
    case 'yearly':
      return `yearly:${pad2(rule.month)}-${pad2(rule.day)}`
    case 'every':
    case 'after':
      return `${rule.kind}:${rule.n}${rule.unit}`
  }
}

const UNIT_LABELS: Record<RepeatUnit, string> = { d: '日', w: '週', m: 'か月' }

/** 繰り返しを日本語で表す（例：毎月第2火曜） */
export function describeRepeat(rule: RepeatRule): string {
  switch (rule.kind) {
    case 'daily':
      return '毎日'
    case 'weekdays':
      return '平日（月〜金）'
    case 'weekly':
      return `毎週${rule.days.map((d) => WEEKDAY_LABELS[d]).join('・')}曜`
    case 'monthly-day':
      return `毎月${rule.day}日`
    case 'monthly-end':
      return '毎月末'
    case 'monthly-nth':
      return `毎月${rule.n === 'last' ? '最終' : `第${rule.n}`}${WEEKDAY_LABELS[rule.weekday]}曜`
    case 'yearly':
      return `毎年${rule.month}月${rule.day}日`
    case 'every':
      return `${rule.n}${UNIT_LABELS[rule.unit]}ごと`
    case 'after':
      return `完了から${rule.n}${rule.unit === 'w' ? '週間' : UNIT_LABELS[rule.unit]}後`
  }
}

// ---- 日付の計算 ----

function toDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function toText(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = toDate(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toText(d)
}

/** year 年と month 月（0 始まり。12 以上は翌年に繰り上がる）を正規化する */
function normalizeMonth(year: number, month: number): [number, number] {
  return [year + Math.floor(month / 12), ((month % 12) + 12) % 12]
}

/** year 年 month 月（0 始まり。繰り上がりあり）の day 日。月にない日は月末にする */
function clampedDate(year: number, month: number, day: number): string {
  const [y, m] = normalizeMonth(year, month)
  return toText(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))))
}

/** year 年 month 月（0 始まり。繰り上がりあり）の第 n 曜日。n が 'last' なら最終の曜日 */
function nthWeekday(year: number, month: number, n: NthWeek, weekday: number): string {
  const [y, m] = normalizeMonth(year, month)
  if (n === 'last') {
    const last = new Date(Date.UTC(y, m, daysInMonth(y, m)))
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))
    return toText(last)
  }
  const first = new Date(Date.UTC(y, m, 1))
  first.setUTCDate(1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7)
  return toText(first)
}

/** n か月後の同じ日。月にない日（31日など）は月末にする */
function addMonths(date: string, n: number): string {
  const d = toDate(date)
  return clampedDate(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())
}

function addInterval(date: string, n: number, unit: RepeatUnit): string {
  if (unit === 'd') return addDays(date, n)
  if (unit === 'w') return addDays(date, n * 7)
  return addMonths(date, n)
}

/** 条件に合う、anchor より後の最初の日（月単位の規則用。pick は年と月から候補の日を返す） */
function firstMonthlyAfter(anchor: string, pick: (year: number, month: number) => string): string {
  const d = toDate(anchor)
  for (let offset = 0; ; offset++) {
    const candidate = pick(d.getUTCFullYear(), d.getUTCMonth() + offset)
    if (candidate > anchor) return candidate
  }
}

/** 条件に合う、anchor より後の最初の日（日単位の規則用） */
function firstDayAfter(anchor: string, matches: (weekday: number) => boolean): string {
  let date = addDays(anchor, 1)
  while (!matches(toDate(date).getUTCDay())) date = addDays(date, 1)
  return date
}

/**
 * 次回の日付を計算する
 * @param anchor 元の予定の日（着手日。なければ期限、どちらもなければ完了した日）
 * @param completedOn 完了した日。`after:` だけがこの日から数える（RULES.md「完了が遅れても次回の日付は変わらない」）
 */
export function nextOccurrence(rule: RepeatRule, anchor: string, completedOn: string): string {
  switch (rule.kind) {
    case 'after':
      return addInterval(completedOn, rule.n, rule.unit)
    case 'every':
      return addInterval(anchor, rule.n, rule.unit)
    case 'daily':
      return addDays(anchor, 1)
    case 'weekdays':
      return firstDayAfter(anchor, (w) => w !== 0 && w !== 6)
    case 'weekly':
      return firstDayAfter(anchor, (w) => rule.days.includes(w))
    case 'monthly-day':
      return firstMonthlyAfter(anchor, (y, m) => clampedDate(y, m, rule.day))
    case 'monthly-end':
      return firstMonthlyAfter(anchor, (y, m) => clampedDate(y, m, 31))
    case 'monthly-nth':
      return firstMonthlyAfter(anchor, (y, m) => nthWeekday(y, m, rule.n, rule.weekday))
    case 'yearly': {
      const year = toDate(anchor).getUTCFullYear()
      for (let offset = 0; ; offset++) {
        const candidate = clampedDate(year + offset, rule.month - 1, rule.day)
        if (candidate > anchor) return candidate
      }
    }
  }
}

/** 2つの `YYYY-MM-DD` の日数の差（b - a） */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000)
}

// ---- 次回分のチケット ----

export interface NextSchedule {
  due: string | null
  start: string | null
}

/**
 * 完了したチケットの次回分の日付を決める。repeat がない・読めないときは null
 * - 着手日があれば、次回の着手日を repeat から計算し、期限は元の着手日から期限までの日数を保ってずらす
 *   （「木曜に始めて2日かける」作業を、毎回木曜に始められるように）
 * - 着手日がなく期限だけなら、期限を repeat で進める
 * - どちらもなければ、完了した日から数えた日を期限にする
 */
export function nextSchedule(ticket: Ticket, completedOn: string): NextSchedule | null {
  const rule = parseRepeat(ticket.repeat)
  if (!rule) return null
  const due = validDate(ticket.due)
  const start = validDate(ticket.start)
  const next = nextOccurrence(rule, start ?? due ?? completedOn, completedOn)
  if (start) return { start: next, due: due ? addDays(next, daysBetween(start, due)) : null }
  return { start: null, due: next }
}

/**
 * すでに作ってある次回分を探す（完了を取り消してもう一度完了したときに、二重に作らないため）
 * タイトル・繰り返し・親・日付が同じチケットを、同じ次回分とみなす
 */
export function findExistingNext(
  ticket: Ticket,
  next: NextSchedule,
  tickets: Ticket[]
): Ticket | null {
  return (
    tickets.find(
      (t) =>
        t.fileName !== ticket.fileName &&
        t.title === ticket.title &&
        t.repeat === ticket.repeat &&
        t.parent === ticket.parent &&
        t.due === next.due &&
        t.start === next.start
    ) ?? null
  )
}

/** 本文の最初の空の見出し（テンプレートの `#`）にタイトルを入れる。なければ先頭に見出しを足す */
export function withTitle(text: string, title: string): string {
  const body = splitFrontmatter(text)?.body ?? text
  const heading = /^#[ \t]*$/m
  // タイトルに `$&` や `$1` があっても置換のパターンとして読まれないよう、置換は関数で渡す
  const newBody = heading.test(body)
    ? body.replace(heading, () => `# ${title}`)
    : `\n# ${title}\n${body}`
  return replaceBody(text, newBody)
}

/**
 * 次回分のチケットの中身を作る（RULES.md「完了にするとき」）
 * タイトル・tags・priority・repeat・parent・assignee を引き継ぎ、本文のメモは引き継がない
 * @param author 作成者（設定の「自分の名前」）。空なら空のまま
 */
export function buildNextTicket(
  template: string,
  id: string,
  created: string,
  ticket: Ticket,
  next: NextSchedule,
  author: string
): string {
  const fields: FieldUpdates = {
    due: next.due,
    start: next.start,
    repeat: ticket.repeat,
    tags: ticket.tags,
    parent: ticket.parent,
    // 担当者は全員を引き継ぐ（1人なら文字列、2人以上ならリスト）
    assignee: assigneeField(ticket.assignee)
  }
  // 優先度が空なら、テンプレートの値のままにする
  if (ticket.priority !== null) fields.priority = ticket.priority
  if (author) fields.author = author
  const text = setFields(fillTemplate(template, id, created), fields)
  return ticket.title ? withTitle(text, ticket.title) : text
}
