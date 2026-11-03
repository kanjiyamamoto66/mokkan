// チケット（1ファイル）の読み取り・ID・並べ替え・警告など、ファイルや画面に依存しない処理
// 裏方（main）と画面（renderer）の両方から使う

import { parse } from 'yaml'

export type Status = 'todo' | 'doing' | 'waiting' | 'done'
export const STATUSES: readonly Status[] = ['todo', 'doing', 'waiting', 'done']

export type Priority = 1 | 2 | 3
/** priority が空・不正なときに使う値（RULES.md「迷ったら 2」） */
export const DEFAULT_PRIORITY: Priority = 2

export interface Ticket {
  /**
   * チケットを表すキー。tickets/ のファイルはファイル名、アーカイブしたものは `archive/ファイル名`
   * （画面と裏方の間で、どのファイルかを指すのに使う）
   */
  fileName: string
  /** tasks/archive/ にあるか */
  archived: boolean
  /** ファイル名の先頭から読んだID。IDで始まらない名前なら null */
  fileId: string | null
  /** frontmatter の id */
  id: string | null
  title: string
  status: Status | null
  priority: Priority | null
  start: string | null
  due: string | null
  repeat: string | null
  tags: string[]
  parent: string | null
  /** このチケットを起こした元のノートの id */
  source: string | null
  /** 担当者（複数人）。ファイルでは1人なら文字列、2人以上ならリストで書く（assigneeField） */
  assignee: string[]
  author: string | null
  created: string | null
  done: string | null
  /** ファイルの更新日時（ミリ秒）。裏方がファイルから読んだときだけ入る。同期サービスでも変わることがある */
  modified:
    | number
    | null
    /** frontmatter が読めなかったときの理由 */
    | null
  /** frontmatter が読めなかったときの理由 */
  parseError: string | null
}

export type WarningKind =
  | 'parse-error'
  | 'not-id-filename'
  | 'id-mismatch'
  | 'duplicate-id'
  | 'missing-parent'
  | 'parent-cycle'
  | 'missing-source'
  | 'start-after-due'
  /** tasks/TAGS.md（タグの色）が読めない・競合コピーがある */
  | 'tags-file'

export interface TicketWarning {
  kind: WarningKind
  message: string
  fileNames: string[]
}

// ---- ID とファイル名 ----

export const ID_PATTERN = /^\d{8}-\d{4}-[a-z0-9]{4}$/
const FILE_NAME_PATTERN = /^(\d{8}-\d{4}-[a-z0-9]{4})(?:_.*)?\.md$/
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** ファイル名（`ID.md` か `ID_任意の文字.md`）の先頭のIDを返す */
export function idFromFileName(fileName: string): string | null {
  return FILE_NAME_PATTERN.exec(fileName)?.[1] ?? null
}

/** ファイル名のタイトル部分の長さの上限（RULES.md「ファイル名」） */
const MAX_FILE_TITLE_LENGTH = 40

/**
 * 見出しを付けたファイル名（`ID_タイトル.md`）を作る（RULES.md「ファイル名」の決まり）
 * Windows で使えない `\ / : * ? " < > |` と制御文字を除き、タイトル部分は40文字までにする
 * @returns 付けられるタイトルがなければ null
 */
export function titledFileName(id: string, title: string): string | null {
  const cleaned = [
    // eslint-disable-next-line no-control-regex
    ...title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').trim()
  ]
    .slice(0, MAX_FILE_TITLE_LENGTH)
    .join('')
    // Windows は名前の最後の空白とピリオドを消してしまうので、先に除く
    .replace(/[ .]+$/, '')
  return cleaned === '' ? null : `${id}_${cleaned}.md`
}

/** 読み込む対象のファイルか（mdだけ。隠しファイルや同期の一時ファイルは無視） */
export function isTicketFileName(fileName: string): boolean {
  return fileName.endsWith('.md') && !fileName.startsWith('.') && !fileName.startsWith('~$')
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 現地時刻の `YYYY-MM-DD` */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 現地時刻の `YYYY-MM-DD HH:MM` */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * `YYYYMMDD-HHMM-xxxx` のIDを作る。時刻は現地時刻（分まで）
 * @param randomInt 0以上 max 未満の整数を返す関数（テストで差し替える）
 */
export function generateId(now: Date, randomInt: (max: number) => number): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += ID_CHARS[randomInt(ID_CHARS.length)]
  return `${date}-${time}-${suffix}`
}

/**
 * 作成日時の表示。ID の先頭 `YYYYMMDD-HHMM` は作成した日時（現地時刻・分まで）なので、
 * `created` と同じ日なら時刻を付けて `YYYY-MM-DD HH:MM` にする。
 * `created` と ID の日付が食い違うときは `created` を優先し、時刻は出さない
 */
export function createdLabel(ticket: Ticket): string | null {
  if (!ticket.created) return null
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(ticket.id ?? ticket.fileId ?? '')
  if (!match) return ticket.created
  const [, y, m, d, hh, mm] = match
  if (`${y}-${m}-${d}` !== ticket.created || Number(hh) > 23 || Number(mm) > 59) {
    return ticket.created
  }
  return `${ticket.created} ${hh}:${mm}`
}

// ---- frontmatter と本文 ----

export interface SplitResult {
  /** `---` の行を含まない、frontmatter の中身 */
  frontmatter: string
  /** frontmatter の後ろ（閉じの `---` の次の行から） */
  body: string
}

/** ファイルの中身を frontmatter と本文に分ける。frontmatter がなければ null */
export function splitFrontmatter(text: string): SplitResult | null {
  const open = /^---\r?\n/.exec(text)
  if (!open) return null
  const rest = text.slice(open[0].length)
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(rest)
  if (!close) return null
  return {
    frontmatter: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length)
  }
}

/** 本文の最初の `# 見出し` をタイトルとして返す */
export function titleFromBody(body: string): string {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body)
  return match?.[1].trim() ?? ''
}

export function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return formatDate(value)
  return null
}

function asStatus(value: unknown): Status | null {
  return STATUSES.find((s) => s === value) ?? null
}

function asPriority(value: unknown): Priority | null {
  const n = typeof value === 'string' ? Number(value) : value
  return n === 1 || n === 2 || n === 3 ? n : null
}

export function asTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter((v): v is string => v !== null)
  const single = asString(value)
  return single ? [single] : []
}

/** ファイル名と中身からチケットを読み取る。書き換えは一切しない */
export function parseTicket(fileName: string, text: string): Ticket {
  const ticket: Ticket = {
    fileName,
    archived: false,
    fileId: idFromFileName(fileName),
    id: null,
    title: '',
    status: null,
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
    parseError: null
  }

  const split = splitFrontmatter(text)
  if (!split) {
    ticket.parseError = 'frontmatter（先頭の --- で囲んだ部分）がありません'
    ticket.title = titleFromBody(text)
    return ticket
  }
  ticket.title = titleFromBody(split.body)

  let data: unknown
  try {
    data = parse(split.frontmatter)
  } catch (error) {
    ticket.parseError = `frontmatter を読めません：${(error as Error).message.split('\n')[0]}`
    return ticket
  }
  if (data === null || data === undefined) data = {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    ticket.parseError = 'frontmatter が「項目: 値」の形になっていません'
    return ticket
  }

  const fm = data as Record<string, unknown>
  ticket.id = asString(fm.id)
  ticket.status = asStatus(fm.status)
  ticket.priority = asPriority(fm.priority)
  ticket.start = asString(fm.start)
  ticket.due = asString(fm.due)
  ticket.repeat = asString(fm.repeat)
  ticket.tags = asTags(fm.tags)
  ticket.parent = asString(fm.parent)
  ticket.source = asString(fm.source)
  ticket.assignee = asTags(fm.assignee)
  ticket.author = asString(fm.author)
  ticket.created = asString(fm.created)
  ticket.done = asString(fm.done)
  return ticket
}

// ---- 新規作成 ----

/** 本文が空か（テンプレートの空の見出し `#` と空白だけなら空とみなす） */
export function isBlankBody(body: string): boolean {
  return body.replace(/^[ \t]*#[ \t]*$/gm, '').trim() === ''
}

/**
 * テンプレートの `id:` と `created:` の行だけを書き換える。それ以外は1文字も変えない
 * @param name エラーの文に出すテンプレートの名前（ノートは NOTE_TEMPLATE.md）
 * @throws テンプレートに frontmatter や `id:` `created:` の行がないとき
 */
export function fillTemplate(
  template: string,
  id: string,
  created: string,
  name = 'TEMPLATE.md'
): string {
  const open = /^---\r?\n/.exec(template)
  const split = splitFrontmatter(template)
  if (!open || !split) throw new Error(`${name} に frontmatter がありません`)

  let filled = split.frontmatter
  for (const [key, value] of [
    ['id', id],
    ['created', created]
  ] as const) {
    const line = new RegExp(`^${key}:[^\\r\\n]*`, 'm')
    if (!line.test(filled)) throw new Error(`${name} に「${key}:」の行がありません`)
    filled = filled.replace(line, `${key}: ${value}`)
  }

  const start = open[0].length
  const end = start + split.frontmatter.length
  return template.slice(0, start) + filled + template.slice(end)
}

// ---- 一覧 ----

export interface ListFilter {
  statuses: Status[]
  tags: string[]
  priorities: Priority[]
  /** 担当者。UNASSIGNED は「未割り当て」（担当者が空） */
  assignees: string[]
  /** start が今日より後のチケットも表示するか（一覧だけで使う。カレンダーとガントは先の予定も表示する） */
  showFutureStart: boolean
  /** 完了したチケットも表示するか */
  showDone: boolean
  /** アーカイブしたチケットも表示するか */
  showArchived: boolean
}

/** 担当者の絞り込みで「未割り当て」を表す値（名前は空にならないので重ならない） */
export const UNASSIGNED = ''

export const DEFAULT_FILTER: ListFilter = {
  statuses: [],
  tags: [],
  priorities: [],
  assignees: [],
  showFutureStart: false,
  showDone: false,
  showArchived: false
}

export function effectivePriority(ticket: Ticket): Priority {
  return ticket.priority ?? DEFAULT_PRIORITY
}

/** 期限の近い順。期限がないものは最後。期限が同じなら優先度の高い順 */
export function compareTickets(a: Ticket, b: Ticket): number {
  if (a.due !== b.due) {
    if (a.due === null) return 1
    if (b.due === null) return -1
    return a.due < b.due ? -1 : 1
  }
  const byPriority = effectivePriority(a) - effectivePriority(b)
  if (byPriority !== 0) return byPriority
  return (a.id ?? a.fileName).localeCompare(b.id ?? b.fileName)
}

// ---- 一覧の並べ替え ----

export type SortKey = 'due' | 'start' | 'priority' | 'created' | 'modified' | 'status' | 'title'
export const SORT_KEYS: readonly SortKey[] = [
  'due',
  'start',
  'priority',
  'created',
  'modified',
  'status',
  'title'
]
export type SortDirection = 'asc' | 'desc'

export interface ListSort {
  key: SortKey
  direction: SortDirection
}

/** 既定の並び順（期限の近い順。compareTickets と同じ） */
export const DEFAULT_SORT: ListSort = { key: 'due', direction: 'asc' }

/** 設定ファイルや IPC から来た値を確かめる。正しくなければ null */
export function asListSort(value: unknown): ListSort | null {
  if (!value || typeof value !== 'object') return null
  const { key, direction } = value as Record<string, unknown>
  const validKey = SORT_KEYS.find((k) => k === key)
  if (!validKey || (direction !== 'asc' && direction !== 'desc')) return null
  return { key: validKey, direction }
}

/** 並べ替えに使う値。値がないものは null（向きに関係なく最後に置く） */
function sortValue(t: Ticket, key: SortKey): string | number | null {
  switch (key) {
    case 'due':
      return t.due
    case 'start':
      return t.start
    case 'priority':
      return effectivePriority(t)
    case 'created':
      // 同じ日に作ったものは、ID の先頭の時刻で並ぶ
      return t.created === null ? null : `${t.created} ${t.id ?? t.fileId ?? ''}`
    case 'modified':
      return t.modified
    case 'status':
      return t.status === null ? null : STATUSES.indexOf(t.status)
    case 'title':
      return t.title === '' ? null : t.title
  }
}

/**
 * 選んだ基準で比べる関数を返す。値がないものは向きに関係なく最後に置き、
 * 同じ値どうしは既定の並び順（compareTickets）で並べる
 */
export function ticketComparator(sort: ListSort): (a: Ticket, b: Ticket) => number {
  const sign = sort.direction === 'asc' ? 1 : -1
  return (a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va !== vb) {
      if (va === null) return 1
      if (vb === null) return -1
      const order =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'ja')
      if (order !== 0) return order * sign
    }
    return compareTickets(a, b)
  }
}

/** 状態・タグ・優先度・担当者・完了・アーカイブの絞り込みに合うか（一覧・カレンダー・ガントで共通） */
export function matchesFilter(t: Ticket, filter: ListFilter): boolean {
  if (t.archived && !filter.showArchived) return false
  if (t.status === 'done' && !filter.showDone && !(t.archived && filter.showArchived)) return false
  if (filter.statuses.length > 0 && !(t.status && filter.statuses.includes(t.status))) return false
  if (filter.tags.length > 0 && !t.tags.some((tag) => filter.tags.includes(tag))) return false
  if (filter.priorities.length > 0 && !filter.priorities.includes(effectivePriority(t)))
    return false
  // 担当者は「選んだ人のどれかが担当に入っている」。未割り当ては担当者が空のもの
  if (
    filter.assignees.length > 0 &&
    !(t.assignee.length === 0
      ? filter.assignees.includes(UNASSIGNED)
      : t.assignee.some((a) => filter.assignees.includes(a)))
  )
    return false
  return true
}

/** 一覧に出すチケット（絞り込み済み・並べ替え済み）を返す。完了は既定で隠す */
export function listTickets(
  tickets: Ticket[],
  filter: ListFilter,
  today: string,
  sort: ListSort = DEFAULT_SORT
): Ticket[] {
  return tickets
    .filter((t) => matchesFilter(t, filter))
    .filter((t) => filter.showFutureStart || t.start === null || t.start <= today)
    .sort(ticketComparator(sort))
}

/** すべてのタグを五十音・アルファベット順で返す */
export function collectTags(tickets: ReadonlyArray<{ tags: string[] }>): string[] {
  return [...new Set(tickets.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ja'))
}

/** これまでに入力された担当者の名前を五十音・アルファベット順で返す（入力の候補に使う） */
export function collectAssignees(tickets: Ticket[]): string[] {
  return [...new Set(tickets.flatMap((t) => t.assignee))].sort((a, b) => a.localeCompare(b, 'ja'))
}

// ---- 警告（競合コピー・食い違い・親子関係） ----

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** チケットとノートに共通する、ファイルとしての項目 */
interface FileEntry {
  fileName: string
  fileId: string | null
  id: string | null
  parseError: string | null
}

/** frontmatter が読めない・ファイル名と id の食い違いなど、ファイルとしての警告 */
function fileWarnings(f: FileEntry): TicketWarning[] {
  const warnings: TicketWarning[] = []
  if (f.parseError) {
    warnings.push({ kind: 'parse-error', message: f.parseError, fileNames: [f.fileName] })
  }
  if (f.fileId === null) {
    warnings.push({
      kind: 'not-id-filename',
      message: 'ファイル名がIDで始まっていません。同期サービスの競合コピーかもしれません',
      fileNames: [f.fileName]
    })
  } else if (!f.parseError && f.id !== f.fileId) {
    warnings.push({
      kind: 'id-mismatch',
      message: `ファイル名のID（${f.fileId}）と frontmatter の id（${f.id ?? '空'}）が違います`,
      fileNames: [f.fileName]
    })
  }
  return warnings
}

/**
 * 確認が必要なファイルを返す
 * @param notes ノート。ID の重なりはチケットとノートをまたいで確かめ、`source` の先があるかも確かめる
 */
export function findWarnings(tickets: Ticket[], notes: FileEntry[] = []): TicketWarning[] {
  const warnings: TicketWarning[] = []

  for (const t of tickets) {
    warnings.push(...fileWarnings(t))
    // カレンダーとガントでは due の1日として表示するので、食い違いに気づけるよう知らせる
    if (t.start && t.due && DATE_ONLY.test(t.start) && DATE_ONLY.test(t.due) && t.start > t.due) {
      warnings.push({
        kind: 'start-after-due',
        message: `着手日（${t.start}）が期限（${t.due}）より後になっています`,
        fileNames: [t.fileName]
      })
    }
  }

  for (const n of notes) warnings.push(...fileWarnings(n))

  const byId = new Map<string, Ticket[]>()
  for (const t of tickets) {
    if (!t.id) continue
    byId.set(t.id, [...(byId.get(t.id) ?? []), t])
  }
  // ID はチケットとノートをまたいで重ならないようにする（RULES.md「ID」）
  const allById = new Map<string, FileEntry[]>()
  for (const f of [...tickets, ...notes]) {
    if (!f.id) continue
    allById.set(f.id, [...(allById.get(f.id) ?? []), f])
  }
  for (const [id, same] of allById) {
    if (same.length > 1) {
      warnings.push({
        kind: 'duplicate-id',
        message: `同じ id（${id}）のファイルが ${same.length} つあります。競合コピーかもしれません`,
        fileNames: same.map((t) => t.fileName)
      })
    }
  }

  const reportedCycles = new Set<string>()
  for (const t of tickets) {
    if (!t.parent) continue
    if (!byId.has(t.parent)) {
      warnings.push({
        kind: 'missing-parent',
        message: `親チケット（${t.parent}）が見つかりません`,
        fileNames: [t.fileName]
      })
      continue
    }
    // 親をたどって自分に戻ってきたら循環
    const seen = new Set<string>()
    let current: string | null = t.parent
    while (current && !seen.has(current)) {
      seen.add(current)
      current = byId.get(current)?.[0].parent ?? null
    }
    if (current && t.id && seen.has(t.id)) {
      const key = [...seen].sort().join(',')
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key)
        const members = tickets.filter((x) => x.id && seen.has(x.id))
        warnings.push({
          kind: 'parent-cycle',
          message: '親子関係が循環しています（お互いを親にしています）',
          fileNames: members.map((x) => x.fileName)
        })
      }
    }
  }

  const noteIds = new Set(notes.flatMap((n) => (n.id ? [n.id] : [])))
  for (const t of tickets) {
    if (t.source && !noteIds.has(t.source)) {
      warnings.push({
        kind: 'missing-source',
        message: `元のノート（${t.source}）が見つかりません`,
        fileNames: [t.fileName]
      })
    }
  }

  return warnings
}
