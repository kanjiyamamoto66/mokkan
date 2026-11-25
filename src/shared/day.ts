// 時間割（tasks/days/）の読み書き。画面や裏方に依存しない処理
//
// - 1日1ファイル：days/YYYY-MM-DD.md。frontmatter に date、本文に1行ずつ `- HH:MM-HH:MM 内容`
// - いつもの予定：days/routine.md に `- <繰り返しの規則> HH:MM-HH:MM 内容`。その日のファイルを初めて作るときに写す
// - アプリが読み書きするのは、決まった形の行だけ。ほかの行（人や AI のメモ）は1文字も変えない
// - 所要時間（チケットの estimate）の書き方 `30m`・`1h`・`1h30m` もここで扱う

import { occursOn, parseRepeat } from './repeat'
import { splitFrontmatter, type Ticket } from './ticket'

/** tasks/ の中の、時間割のフォルダ */
export const DAYS_DIR = 'days'
/** いつもの予定のファイル（days/ の中） */
export const ROUTINE_FILE = 'routine.md'
/** 1日の分 */
export const MINUTES_PER_DAY = 24 * 60

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** days/ の中の日のファイル名（`2026-11-24.md`）なら日付。そうでなければ null */
export function dateOfDayFile(fileName: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName)
  return m && isValidDate(m[1]) ? m[1] : null
}

/** 実在する `YYYY-MM-DD` か */
export function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false
  const d = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}

// ---- 時刻と所要時間 ----

/** `HH:MM`（`9:00` も可）を 0時からの分にする。`24:00` は終わりの時刻だけに使える。読めなければ null */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null
  return h * 60 + min
}

/** 0時からの分を `HH:MM` にする */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export { MAX_ESTIMATE, durationLabel, formatDuration, parseDuration } from './duration'

// ---- 日のファイル ----

/** 時間割の1行 */
export interface DayEntry {
  /** ファイルの何行目か（0 始まり。frontmatter も数える） */
  line: number
  /** その行の文字（書き換える前に、変わっていないかを確かめるのに使う） */
  raw: string
  /** 始まりと終わり（0時からの分） */
  start: number
  end: number
  /** 時刻の後ろの内容（リンクならリンクの書き方のまま） */
  content: string
  /** 内容の最初の md のリンクの文字とリンク先。なければ null */
  label: string | null
  href: string | null
}

/** 決まった形にできなかった行（`- 10:00 定例` など）。消さずに表示だけする */
export interface BrokenLine {
  line: number
  raw: string
}

export interface DayContent {
  entries: DayEntry[]
  broken: BrokenLine[]
}

const ENTRY_LINE = /^- (\d{1,2}:\d{2})-(\d{1,2}:\d{2})[ \t]+(\S.*?)[ \t]*$/
/**
 * 時刻で始まるつもりの行（形が崩れていれば「読めない行」にする）
 * `- 3社に連絡` のようなメモは対象にしないよう、`HH:MM` で始まる行だけにする
 */
const TIME_LIKE_LINE = /^[-*+][ \t]*\d{1,2}:\d{2}/
const FIRST_LINK = /\[([^\]]*)\]\((<[^>]*>|[^)\s]*)\)/

/** 内容の最初の md のリンク */
export function linkOf(content: string): { label: string; href: string } | null {
  const m = FIRST_LINK.exec(content)
  if (!m) return null
  const href = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2]
  return { label: m[1], href }
}

/** 行に分ける（改行は LF か CRLF。最後の改行の後ろの空の行も1つの要素になる） */
function splitLines(text: string): { lines: string[]; newline: string } {
  return { lines: text.split(/\r?\n/), newline: text.includes('\r\n') ? '\r\n' : '\n' }
}

/** 本文が始まる行（frontmatter の後ろ）。frontmatter がなければ 0 */
function bodyStartLine(text: string): number {
  const split = splitFrontmatter(text)
  if (!split) return 0
  return text.slice(0, text.length - split.body.length).split(/\r?\n/).length - 1
}

/** 1行を時間割の行として読む。形が違えば null */
function parseEntryLine(raw: string): Omit<DayEntry, 'line'> | null {
  const m = ENTRY_LINE.exec(raw)
  if (!m) return null
  const start = parseTime(m[1])
  const end = parseTime(m[2])
  if (start === null || end === null || start >= MINUTES_PER_DAY || end <= start) return null
  const link = linkOf(m[3])
  return { raw, start, end, content: m[3], label: link?.label ?? null, href: link?.href ?? null }
}

/** 日のファイルの、時間割の行と読めない行を読む。ほかの行は読まない */
export function parseDay(text: string): DayContent {
  const { lines } = splitLines(text)
  const entries: DayEntry[] = []
  const broken: BrokenLine[] = []
  for (let i = bodyStartLine(text); i < lines.length; i++) {
    const raw = lines[i]
    const entry = parseEntryLine(raw)
    if (entry) entries.push({ line: i, ...entry })
    else if (TIME_LIKE_LINE.test(raw)) broken.push({ line: i, raw })
  }
  return { entries, broken }
}

/** 時間割の1行を書く */
export function entryLine(start: number, end: number, content: string): string {
  return `- ${formatTime(start)}-${formatTime(end)} ${content.replace(/[\r\n]+/g, ' ').trim()}`
}

/** 新しい日のファイルの中身（frontmatter と、いつもの予定から写した行） */
export function newDayText(date: string, lines: string[] = []): string {
  return `---\ndate: ${date}\n---\n\n${lines.map((l) => `${l}\n`).join('')}`
}

/**
 * 時間割の書き換え
 * - add：行を足す（始まりの時刻の順の位置に入れる）
 * - update：行を書き換える。始まりが変わったら、時刻の順の位置に移す
 * - remove：行を消す
 * - touch：何も変えない（ファイルがなければ、いつもの予定を写して作るためだけに使う）
 * update と remove は、画面が読んだときの行（raw）が今もあるときだけ行う（findLine）
 */
export type DayEdit =
  | { kind: 'add'; start: number; end: number; content: string }
  | { kind: 'update'; line: number; raw: string; start: number; end: number; content: string }
  | { kind: 'remove'; line: number; raw: string }
  | { kind: 'touch' }

/** 書き換えの値を確かめる。おかしければ理由を返す */
export function dayEditError(edit: DayEdit): string | null {
  if (edit.kind === 'remove' || edit.kind === 'touch') return null
  if (
    !Number.isInteger(edit.start) ||
    !Number.isInteger(edit.end) ||
    edit.start < 0 ||
    edit.start >= MINUTES_PER_DAY ||
    edit.end <= edit.start ||
    edit.end > MINUTES_PER_DAY
  ) {
    return '時刻が正しくありません'
  }
  if (edit.content.trim() === '') return '内容が空です'
  return null
}

/** 時刻の順の位置に行を入れる */
function insertSorted(lines: string[], text: string, start: number, newLine: string): void {
  const entries = parseDay(lines.join('\n')).entries
  const after = entries.find((e) => e.start > start)
  if (after) {
    lines.splice(after.line, 0, newLine)
    return
  }
  const last = entries.at(-1)
  if (last) {
    lines.splice(last.line + 1, 0, newLine)
    return
  }
  // 時間割の行がまだなければ、本文の最後（最後の改行の前）に足す
  let at = lines.length
  if (lines[at - 1] === '') at--
  // frontmatter の直後なら、空の行を1つ空ける
  if (at === bodyStartLine(text) && at > 0) {
    lines.splice(at, 0, '')
    at++
  }
  lines.splice(at, 0, newLine)
  if (lines[lines.length - 1] !== '') lines.push('')
}

/**
 * 画面が読んだときの行（raw）の、今の位置
 * - 同じ位置にあればそこ
 * - 位置がずれていれば（前の書き換えで行が増えた・減ったなど）、同じ文字の行が1つだけのときはそこ
 * - 見つからない・同じ文字の行が2つ以上あってどれか分からないときは null
 */
function findLine(lines: string[], line: number, raw: string): number | null {
  if (lines[line] === raw) return line
  const same = lines.flatMap((l, i) => (l === raw ? [i] : []))
  return same.length === 1 ? same[0] : null
}

/**
 * 日のファイルを書き換える
 * @returns 書き換えた中身。書き換える行が見つからなければ（外で書き換えられたなど）null
 */
export function applyDayEdit(text: string, edit: DayEdit): string | null {
  const { lines, newline } = splitLines(text)
  if (edit.kind === 'touch') return text
  const at = edit.kind === 'add' ? null : findLine(lines, edit.line, edit.raw)
  if (edit.kind !== 'add' && at === null) return null
  if (edit.kind === 'remove') {
    lines.splice(at!, 1)
    return lines.join(newline)
  }
  const line = entryLine(edit.start, edit.end, edit.content)
  if (edit.kind === 'update') {
    const before = parseEntryLine(edit.raw)
    if (before && before.start === edit.start) {
      lines[at!] = line
      return lines.join(newline)
    }
    lines.splice(at!, 1)
  }
  insertSorted(lines, lines.join(newline), edit.start, line)
  return lines.join(newline)
}

// ---- いつもの予定（days/routine.md） ----

export interface RoutineEntry {
  /** 繰り返しの規則（`weekly:tue`・`every:2w@2026-11-24` など） */
  rule: string
  start: number
  end: number
  content: string
}

const ROUTINE_LINE = /^- (\S+)[ \t]+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})[ \t]+(\S.*?)[ \t]*$/

/** いつもの予定を読む。規則や時刻が読めない行は除く */
export function parseRoutine(text: string): RoutineEntry[] {
  return text.split(/\r?\n/).flatMap((raw): RoutineEntry[] => {
    const m = ROUTINE_LINE.exec(raw)
    if (!m || routineRule(m[1]) === null) return []
    const start = parseTime(m[2])
    const end = parseTime(m[3])
    if (start === null || end === null || start >= MINUTES_PER_DAY || end <= start) return []
    return [{ rule: m[1], start, end, content: m[4] }]
  })
}

/** いつもの予定の規則。`every:` は `@YYYY-MM-DD`（数え始めの日）が要る。`after:` は使えない */
function routineRule(
  text: string
): { rule: NonNullable<ReturnType<typeof parseRepeat>>; startsOn: string | null } | null {
  const [ruleText, startsOn = null, ...rest] = text.split('@')
  if (rest.length > 0) return null
  const rule = parseRepeat(ruleText)
  if (!rule || rule.kind === 'after') return null
  if (rule.kind === 'every') return startsOn && isValidDate(startsOn) ? { rule, startsOn } : null
  return startsOn === null ? { rule, startsOn: null } : null
}

/** 予定の内容を比べるための文字（リンクならリンクの文字。空白の違いは見ない） */
function entryKey(content: string): string {
  return (linkOf(content)?.label ?? content).replace(/\s+/g, ' ').trim()
}

/**
 * その日に当たるいつもの予定のうち、日のファイルにないもの。
 * 内容（リンクならリンクの文字）が同じ予定がファイルにあれば、時刻を直した・議事メモのリンクにした・
 * `9:00` のように書いたものでも「ある」とみなす（「写す」で二重にしないため）
 */
export function missingRoutine(
  routine: RoutineEntry[],
  entries: { content: string; label: string | null }[]
): RoutineEntry[] {
  const keys = new Set(entries.map((e) => entryKey(e.label ?? e.content)))
  return routine.filter((r) => !keys.has(entryKey(r.content)))
}

/** その日に当たるいつもの予定（始まりの時刻の順） */
export function routineFor(routine: RoutineEntry[], date: string): RoutineEntry[] {
  return routine
    .filter((r) => {
      const parsed = routineRule(r.rule)
      return parsed !== null && occursOn(parsed.rule, date, parsed.startsOn)
    })
    .sort((a, b) => a.start - b.start)
}

// ---- 画面に並べる ----

/** 重なった予定を横に並べるための、列の位置と列の数 */
export interface PlacedEntry<T extends { start: number; end: number }> {
  item: T
  column: number
  columns: number
}

/** 時刻が重なる予定を、横に並べる列に分ける（重なりのまとまりごとに列の数を決める） */
export function layoutColumns<T extends { start: number; end: number }>(
  items: T[]
): PlacedEntry<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: PlacedEntry<T>[] = []
  let group: PlacedEntry<T>[] = []
  let groupEnd = -1
  let columnEnds: number[] = []
  const closeGroup = (): void => {
    for (const p of group) p.columns = columnEnds.length
    group = []
    columnEnds = []
  }
  for (const item of sorted) {
    if (item.start >= groupEnd) closeGroup()
    let column = columnEnds.findIndex((end) => end <= item.start)
    if (column < 0) {
      column = columnEnds.length
      columnEnds.push(item.end)
    } else {
      columnEnds[column] = item.end
    }
    const placed = { item, column, columns: 1 }
    group.push(placed)
    result.push(placed)
    groupEnd = Math.max(groupEnd, item.end)
  }
  closeGroup()
  return result
}

/** その日の候補。focus はまずやるもの、started は着手日を過ぎただけのもの */
export interface DayCandidates {
  /** 期限切れ・その日が期限・作業中（入り切るかの目安に数える） */
  focus: Ticket[]
  /** 着手日がその日まで（期限はまだ先・期限なし）。目安には数えない */
  started: Ticket[]
}

/** 所要時間のないチケットを、置くときと目安で数える長さ（分）。skill（mokkan-planning-days）と同じ */
export const DEFAULT_TICKET_MINUTES = 30

function byDue(a: Ticket, b: Ticket): number {
  return (
    (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') ||
    (a.priority ?? 2) - (b.priority ?? 2) ||
    a.title.localeCompare(b.title, 'ja')
  )
}

/**
 * その日の候補のチケット（まだその日に置いていない、やる候補）
 * - 対象：未完了・アーカイブしていない・待ち（waiting）でない・子チケットを持たない（親の作業は子で置く。
 *   所要時間を二重に数えない）・その日にまだ置いていないもの
 * - focus：期限がその日まで（期限切れを含む）か、作業中のもの
 * - started：それ以外で、着手日がその日までのもの（アプリで作ると着手日は作った日になるので、多くなりやすい）
 * 並びは期限の近い順（期限のないものは後ろ）
 * @param placedIds その日の時間割にリンクで置いてあるチケットの ID
 */
export function dayCandidates(
  tickets: Ticket[],
  date: string,
  placedIds: Set<string>
): DayCandidates {
  // 親の作業は子で置くので、未完了の子を持つ親は除く（子がすべて完了した親は、親に残った作業を置ける）
  const parents = new Set(
    tickets.flatMap((t) => (t.parent && !t.archived && t.status !== 'done' ? [t.parent] : []))
  )
  const open = tickets.filter(
    (t) =>
      !t.archived &&
      t.status !== 'done' &&
      t.status !== 'waiting' &&
      !(t.id && parents.has(t.id)) &&
      !(t.id && placedIds.has(t.id))
  )
  const isFocus = (t: Ticket): boolean => (t.due !== null && t.due <= date) || t.status === 'doing'
  return {
    focus: open.filter(isFocus).sort(byDue),
    started: open.filter((t) => !isFocus(t) && t.start !== null && t.start <= date).sort(byDue)
  }
}

/** その日に置ける、候補のほかのチケット（候補に出ないものを探して置くため）。未完了・アーカイブしていないもの */
export function otherTickets(
  tickets: Ticket[],
  candidates: DayCandidates,
  placedIds: Set<string>,
  query: string
): Ticket[] {
  const shown = new Set([...candidates.focus, ...candidates.started].map((t) => t.fileName))
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return tickets
    .filter(
      (t) =>
        !t.archived &&
        t.status !== 'done' &&
        !shown.has(t.fileName) &&
        !(t.id && placedIds.has(t.id)) &&
        words.every((w) => t.title.toLowerCase().includes(w))
    )
    .sort(byDue)
}

/** 作業する時間。0時からの分。days/routine.md の frontmatter の `work: 09:00-18:00` に置く */
export interface WorkHours {
  start: number
  end: number
}

export const DEFAULT_WORK_HOURS: WorkHours = { start: 9 * 60, end: 18 * 60 }

const WORK_KEY = /^work[ \t]*:/
const WORK_LINE = /^work:[ \t]*(["']?)(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\1[ \t]*$/

/** routine.md の frontmatter の行（`---` の間）の、行の番号の範囲。frontmatter がなければ null */
function frontmatterLines(lines: string[]): { from: number; close: number } | null {
  if (lines.length === 0 || lines[0].replace(/\r$/, '') !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?$/.test(lines[i])) return { from: 1, close: i }
  }
  return null
}

/**
 * routine.md の作業する時間（frontmatter の `work: HH:MM-HH:MM`）。
 * ファイルがない・書いていない・読めない値なら null（呼ぶ側が DEFAULT_WORK_HOURS にする）
 */
export function routineWorkHours(text: string | null): WorkHours | null {
  if (!text) return null
  const lines = text.split('\n')
  const range = frontmatterLines(lines)
  if (!range) return null
  for (let i = range.from; i < range.close; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (!WORK_KEY.test(line)) continue
    const m = WORK_LINE.exec(line)
    if (!m) return null
    const start = parseTime(m[2])
    const end = parseTime(m[3])
    return start === null || end === null ? null : asWorkHours({ start, end })
  }
  return null
}

/** 新しく作る routine.md の本文（frontmatter の後） */
const NEW_ROUTINE_BODY = '# いつもの予定\n'

/**
 * routine.md の作業する時間を書き換えた中身。`work:` の行だけを書き換え（なければ frontmatter の最後に足し、
 * frontmatter がなければ先頭に足す）、ほかの行は変えない。ファイルがなければ（null）作る中身を返す
 */
export function setRoutineWorkHours(text: string | null, hours: WorkHours): string {
  const line = `work: ${formatTime(hours.start)}-${formatTime(hours.end)}`
  if (text === null) return `---\n${line}\n---\n\n${NEW_ROUTINE_BODY}`
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split('\n')
  const range = frontmatterLines(lines)
  if (!range) return `---${newline}${line}${newline}---${newline}${newline}${text}`
  const eol = newline === '\r\n' ? '\r' : ''
  for (let i = range.from; i < range.close; i++) {
    if (WORK_KEY.test(lines[i])) {
      lines[i] = `${line}${lines[i].endsWith('\r') ? '\r' : ''}`
      return lines.join('\n')
    }
  }
  lines.splice(range.close, 0, `${line}${eol}`)
  return lines.join('\n')
}

/** 作業する時間として正しい値なら返す（15分刻みでなくてもよい）。そうでなければ null */
export function asWorkHours(value: unknown): WorkHours | null {
  if (!value || typeof value !== 'object') return null
  const { start, end } = value as Record<string, unknown>
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > MINUTES_PER_DAY ||
    end <= start
  ) {
    return null
  }
  return { start, end }
}

/**
 * 作業する時間のうち、予定で埋まっている分（重なりは1回だけ数える）
 */
export function busyMinutes(entries: { start: number; end: number }[], work: WorkHours): number {
  const clipped = entries
    .map((e) => ({ start: Math.max(e.start, work.start), end: Math.min(e.end, work.end) }))
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start)
  let total = 0
  let cursor = work.start
  for (const e of clipped) {
    const from = Math.max(e.start, cursor)
    if (e.end > from) {
      total += e.end - from
      cursor = e.end
    }
  }
  return total
}
