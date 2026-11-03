// カレンダーとガントチャートに渡す予定の計算。ファイルや画面に依存しない純粋な処理

import {
  effectivePriority,
  matchesFilter,
  type ListFilter,
  type Priority,
  type Status,
  type Ticket
} from './ticket'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` として正しい日付なら返す。そうでなければ null */
export function validDate(value: string | null): string | null {
  if (value === null || !DATE_PATTERN.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

/** `YYYY-MM-DD` に日数を足す */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** チケットの期間（両端を含む）。start が due より後なら due の1日だけにする */
export function ticketSpan(t: Ticket): { start: string; end: string } | null {
  const start = validDate(t.start)
  const due = validDate(t.due)
  if (start && due) return start <= due ? { start, end: due } : { start: due, end: due }
  if (due) return { start: due, end: due }
  if (start) return { start, end: start }
  return null
}

/** 期限を過ぎていて未完了か。today が null なら判定しない */
export function isOverdue(t: Ticket, today: string | null): boolean {
  return today !== null && t.status !== 'done' && validDate(t.due) !== null && t.due! < today
}

// ---- カレンダー ----

export interface CalendarItem {
  fileName: string
  title: string
  /** 最初の日（含む） */
  start: string
  /** 最後の日（含む） */
  end: string
  status: Status | null
  priority: Priority
  /** 期限を過ぎていて未完了 */
  overdue: boolean
  /** 祖先のタイトル（一番上の親から順に。マウスを乗せたときに「親 > 子」を出すため） */
  path: string[]
  /** 最初のタグ。左端の線の色に使う（タグのないチケットは null で、線を出さない） */
  tag: string | null
  /**
   * 同じ日に並べる順（小さいほど上）。親子のまとまりの中では親→子→孫の順にし、
   * まとまりどうしは FullCalendar の既定の順（始まりが早い→期間が長い→タイトル）で並べる
   */
  order: number
}

/** FullCalendar の既定の並び順（eventOrder の 'start,-duration,allDay,title'。予定はすべて終日） */
function compareCalendarDefault(a: CalendarItem, b: CalendarItem): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1
  if (a.end !== b.end) return a.end > b.end ? -1 : 1
  return a.title.localeCompare(b.title)
}

/**
 * 並び順（order）を付ける。まとまりの中で一番上に来る予定の位置にまとまり全体を置き、
 * まとまりの中は親子の木をたどった順にする（どの2件を比べても順が矛盾しないよう、1つの数にする）
 */
function assignCalendarOrder(
  items: CalendarItem[],
  familyOf: Map<string, string>,
  treeIndex: Map<string, number>
): CalendarItem[] {
  const heads = new Map<string, CalendarItem>()
  for (const item of items) {
    const family = familyOf.get(item.fileName)!
    const head = heads.get(family)
    if (!head || compareCalendarDefault(item, head) < 0) heads.set(family, item)
  }
  const sorted = [...items].sort((a, b) => {
    const fa = familyOf.get(a.fileName)!
    const fb = familyOf.get(b.fileName)!
    if (fa !== fb) {
      const byHead = compareCalendarDefault(heads.get(fa)!, heads.get(fb)!)
      return byHead !== 0 ? byHead : fa.localeCompare(fb)
    }
    return treeIndex.get(a.fileName)! - treeIndex.get(b.fileName)!
  })
  const order = new Map(sorted.map((item, i) => [item.fileName, i]))
  return items.map((item) => ({ ...item, order: order.get(item.fileName)! }))
}

/**
 * 祖先を、一番上の親から順に返す
 * 親が見つからない・循環しているときは、そこでたどるのをやめる（警告は一覧の警告欄で出す）
 */
function ancestors(t: Ticket, byId: Map<string, Ticket>): Ticket[] {
  const chain: Ticket[] = []
  const seen = new Set<string>([t.fileName])
  let parent = t.parent ? byId.get(t.parent) : undefined
  while (parent && !seen.has(parent.fileName)) {
    seen.add(parent.fileName)
    chain.unshift(parent)
    parent = parent.parent ? byId.get(parent.parent) : undefined
  }
  // 循環していたら、自分に戻ってくるまでの経路は意味がないので出さない
  return parent ? [] : chain
}

/** due の日に置き、start があれば start から due までの帯にする。日付のないチケットは出さない */
export function calendarItems(
  tickets: Ticket[],
  filter: ListFilter,
  today: string
): CalendarItem[] {
  const byId = new Map<string, Ticket>()
  for (const t of tickets) if (t.id && !byId.has(t.id)) byId.set(t.id, t)
  // 親子のまとまり（一番上の親）と、親→子→孫の順の番号
  const familyOf = new Map<string, string>()
  const treeIndex = new Map<string, number>()
  const { children, roots } = buildTree(tickets)
  const walk = (t: Ticket, root: string): void => {
    familyOf.set(t.fileName, root)
    treeIndex.set(t.fileName, treeIndex.size)
    for (const c of [...(children.get(t.fileName) ?? [])].sort(compareForGantt)) walk(c, root)
  }
  for (const r of [...roots].sort(compareForGantt)) walk(r, r.fileName)

  const items = tickets
    .filter((t) => matchesFilter(t, filter))
    .flatMap((t): CalendarItem[] => {
      const span = ticketSpan(t)
      if (!span) return []
      const chain = ancestors(t, byId)
      return [
        {
          fileName: t.fileName,
          title: t.title,
          start: span.start,
          end: span.end,
          status: t.status,
          priority: effectivePriority(t),
          overdue: isOverdue(t, today),
          path: chain.map((a) => a.title || '（タイトルなし）'),
          tag: t.tags[0] ?? null,
          order: 0
        }
      ]
    })
  return assignCalendarOrder(items, familyOf, treeIndex)
}

// ---- ガントチャート ----

/**
 * 行の種類
 * - task：start〜due の棒
 * - milestone：日付が1つだけ（due だけ、または start だけ）の印
 * - summary：子のある親。子孫全体の期間の「まとめ棒」
 * - group：タグごとにまとめるときの見出し行（まとめ棒）
 * - nodate：日付がない。行だけ表示して棒は描かない
 */
export type GanttKind = 'task' | 'milestone' | 'summary' | 'group' | 'nodate'
export type GanttGrouping = 'parent' | 'tag'

export interface GanttRow {
  /** 行の識別子（タグでまとめると同じチケットが複数の行に出るので、ファイル名とは別に持つ） */
  key: string
  /** group の行は null */
  fileName: string | null
  title: string
  parentKey: string | null
  /** 階層の深さ（一番上が 0） */
  depth: number
  kind: GanttKind
  /** 棒の最初の日（含む）。nodate は null */
  start: string | null
  /** 棒の最後の日（含む）。nodate は null */
  end: string | null
  status: Status | null
  priority: Priority
  /** 絞り込みの条件には合わないが、合う子孫の祖先として薄く表示する */
  faded: boolean
  /** 親の期限を子孫がはみ出しているときの説明 */
  warning: string | null
  /** 期限を過ぎていて未完了（赤い枠と「!」の印を付ける） */
  overdue: boolean
  /** 名前の左の線の色に使うタグ（チケットは最初のタグ、タグごとの見出しはそのタグ。「タグなし」は null） */
  tag: string | null
  /** 祖先のタイトル（深い階層で、マウスを乗せたときに「親 > 子 > 孫」を出すため） */
  path: string[]
  /** 最初に開いておくか */
  open: boolean
  hasChildren: boolean
}

/** 最初に開いておく深さ。0 段目（一番上）だけ開くと、2段目まで見える */
const OPEN_DEPTH = 1

/** 始まりの早い順。日付のないものは最後。同じなら優先度の高い順 */
function compareForGantt(a: Ticket, b: Ticket): number {
  const sa = ticketSpan(a)?.start ?? null
  const sb = ticketSpan(b)?.start ?? null
  if (sa !== sb) {
    if (sa === null) return 1
    if (sb === null) return -1
    return sa < sb ? -1 : 1
  }
  const byPriority = effectivePriority(a) - effectivePriority(b)
  if (byPriority !== 0) return byPriority
  return (a.id ?? a.fileName).localeCompare(b.id ?? b.fileName)
}

function union(
  a: { start: string; end: string } | null,
  b: { start: string; end: string } | null
): { start: string; end: string } | null {
  if (!a) return b
  if (!b) return a
  return { start: a.start < b.start ? a.start : b.start, end: a.end > b.end ? a.end : b.end }
}

/**
 * 親子関係をたどった木を作る
 * 親が見つからない子と、循環している親子は一番上に置く（警告は一覧の警告欄で出す）
 */
function buildTree(tickets: Ticket[]): {
  byFile: Map<string, Ticket>
  children: Map<string, Ticket[]>
  roots: Ticket[]
  parentOf: Map<string, Ticket | null>
} {
  const byId = new Map<string, Ticket>()
  for (const t of tickets) if (t.id && !byId.has(t.id)) byId.set(t.id, t)

  const parentOf = new Map<string, Ticket | null>()
  for (const t of tickets) {
    let parent = t.parent ? (byId.get(t.parent) ?? null) : null
    if (parent) {
      // 親をたどって自分に戻ってきたら循環なので、親なしとして扱う
      const seen = new Set<string>([t.fileName])
      let cur: Ticket | null = parent
      while (cur && !seen.has(cur.fileName)) {
        seen.add(cur.fileName)
        cur = cur.parent ? (byId.get(cur.parent) ?? null) : null
      }
      if (cur && cur.fileName === t.fileName) parent = null
    }
    parentOf.set(t.fileName, parent)
  }

  const children = new Map<string, Ticket[]>()
  const roots: Ticket[] = []
  for (const t of tickets) {
    const parent = parentOf.get(t.fileName)
    if (parent) children.set(parent.fileName, [...(children.get(parent.fileName) ?? []), t])
    else roots.push(t)
  }
  return { byFile: new Map(tickets.map((t) => [t.fileName, t])), children, roots, parentOf }
}

function leafKind(t: Ticket): GanttKind {
  const start = validDate(t.start)
  const due = validDate(t.due)
  if (start && due && start < due) return 'task'
  if (start || due) return 'milestone'
  return 'nodate'
}

function ganttByParent(tickets: Ticket[], filter: ListFilter, today: string | null): GanttRow[] {
  const { children, roots, parentOf } = buildTree(tickets)

  // 条件に合うチケットと、その祖先（文脈として薄く表示する）
  const matched = new Set(tickets.filter((t) => matchesFilter(t, filter)).map((t) => t.fileName))
  const visible = new Set(matched)
  for (const t of tickets) {
    if (!matched.has(t.fileName)) continue
    let parent = parentOf.get(t.fileName) ?? null
    while (parent && !visible.has(parent.fileName)) {
      visible.add(parent.fileName)
      parent = parentOf.get(parent.fileName) ?? null
    }
  }

  // 子孫全体の期間（絞り込みで隠れた子孫も含めた、実際の期間）
  const spanMemo = new Map<string, { start: string; end: string } | null>()
  const descendantSpan = (t: Ticket): { start: string; end: string } | null => {
    if (spanMemo.has(t.fileName)) return spanMemo.get(t.fileName)!
    let span: { start: string; end: string } | null = null
    for (const c of children.get(t.fileName) ?? [])
      span = union(span, union(ticketSpan(c), descendantSpan(c)))
    spanMemo.set(t.fileName, span)
    return span
  }

  const rows: GanttRow[] = []
  const walk = (t: Ticket, depth: number, parentKey: string | null, path: string[]): void => {
    const visibleChildren = (children.get(t.fileName) ?? [])
      .filter((c) => visible.has(c.fileName))
      .sort(compareForGantt)
    const hasChildren = visibleChildren.length > 0
    const own = ticketSpan(t)
    const below = descendantSpan(t)
    const span = hasChildren ? union(own, below) : own
    const due = validDate(t.due)
    const warning =
      hasChildren && due && below && below.end > due
        ? `子チケットが親の期限（${due}）を過ぎています（最後は ${below.end}）`
        : null
    rows.push({
      key: t.fileName,
      fileName: t.fileName,
      title: t.title,
      parentKey,
      depth,
      kind: hasChildren ? (span ? 'summary' : 'nodate') : leafKind(t),
      start: span?.start ?? null,
      end: span?.end ?? null,
      status: t.status,
      priority: effectivePriority(t),
      faded: !matched.has(t.fileName),
      warning,
      overdue: isOverdue(t, today),
      tag: t.tags[0] ?? null,
      path,
      open: hasChildren && depth < OPEN_DEPTH,
      hasChildren
    })
    for (const c of visibleChildren) {
      walk(c, depth + 1, t.fileName, [...path, t.title || '（タイトルなし）'])
    }
  }
  for (const t of roots.filter((r) => visible.has(r.fileName)).sort(compareForGantt)) {
    walk(t, 0, null, [])
  }
  return rows
}

const NO_TAG = 'タグなし'

function ganttByTag(tickets: Ticket[], filter: ListFilter, today: string | null): GanttRow[] {
  const matched = tickets.filter((t) => matchesFilter(t, filter)).sort(compareForGantt)
  const groups = new Map<string, Ticket[]>()
  for (const t of matched) {
    for (const tag of t.tags.length > 0 ? t.tags : [NO_TAG]) {
      groups.set(tag, [...(groups.get(tag) ?? []), t])
    }
  }
  const names = [...groups.keys()].sort((a, b) => {
    if (a === NO_TAG) return 1
    if (b === NO_TAG) return -1
    return a.localeCompare(b, 'ja')
  })

  const rows: GanttRow[] = []
  for (const name of names) {
    const members = groups.get(name)!
    const key = `tag:${name}`
    const span = members.reduce<{ start: string; end: string } | null>(
      (acc, t) => union(acc, ticketSpan(t)),
      null
    )
    rows.push({
      key,
      fileName: null,
      title: name,
      parentKey: null,
      depth: 0,
      kind: span ? 'group' : 'nodate',
      start: span?.start ?? null,
      end: span?.end ?? null,
      status: null,
      priority: 2,
      faded: false,
      warning: null,
      overdue: false,
      tag: name === NO_TAG ? null : name,
      path: [],
      open: true,
      hasChildren: true
    })
    for (const t of members) {
      const own = ticketSpan(t)
      rows.push({
        key: `${key}/${t.fileName}`,
        fileName: t.fileName,
        title: t.title,
        parentKey: key,
        depth: 1,
        kind: leafKind(t),
        start: own?.start ?? null,
        end: own?.end ?? null,
        status: t.status,
        priority: effectivePriority(t),
        faded: false,
        warning: null,
        overdue: isOverdue(t, today),
        tag: t.tags[0] ?? null,
        path: [name],
        open: false,
        hasChildren: false
      })
    }
  }
  return rows
}

/**
 * ガントチャートの行を、親→子→孫（またはタグごと）の順に返す
 * @param today 期限切れの判定に使う今日。null なら期限切れの印を付けない
 */
export function ganttRows(
  tickets: Ticket[],
  filter: ListFilter,
  grouping: GanttGrouping,
  today: string | null = null
): GanttRow[] {
  return grouping === 'tag'
    ? ganttByTag(tickets, filter, today)
    : ganttByParent(tickets, filter, today)
}
