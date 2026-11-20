// 編集画面の幅（一覧と編集画面の境目をドラッグして変えたもの）。画面ごとに個人設定に保存する
// PC ごとに画面の広さが違うので、tasks/ には置かない

/** 境目を動かせる画面 */
export const PANE_VIEWS = ['list', 'calendar', 'gantt', 'notes'] as const
export type PaneView = (typeof PANE_VIEWS)[number]

/** 画面ごとの編集画面の幅（px）。動かしていない画面は入らない（初めの幅を使う） */
export type PaneWidths = Partial<Record<PaneView, number>>

/** 編集画面の幅の下限 */
export const MIN_EDITOR_WIDTH = 360
/** 一覧（カレンダー・ガント）の幅の下限 */
export const MIN_MAIN_WIDTH = 260
/** 保存する幅の上限（壊れた値で画面が崩れないように） */
const MAX_EDITOR_WIDTH = 4000

export function isPaneView(value: unknown): value is PaneView {
  return PANE_VIEWS.includes(value as PaneView)
}

/** 幅として使える値なら整数にして返す。使えなければ null */
export function asEditorWidth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const width = Math.round(value)
  return width >= MIN_EDITOR_WIDTH && width <= MAX_EDITOR_WIDTH ? width : null
}

/** 保存した値を読む。知らない画面や使えない幅は捨てる */
export function asPaneWidths(value: unknown): PaneWidths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: PaneWidths = {}
  for (const [view, width] of Object.entries(value)) {
    const valid = asEditorWidth(width)
    if (isPaneView(view) && valid !== null) result[view] = valid
  }
  return result
}

/**
 * ドラッグ中の編集画面の幅を、下限と、一覧が下限より狭くならない幅の間に収める
 * @param available 一覧と編集画面を合わせた幅
 */
export function clampEditorWidth(width: number, available: number): number {
  const max = Math.max(MIN_EDITOR_WIDTH, available - MIN_MAIN_WIDTH)
  return Math.round(Math.min(Math.max(width, MIN_EDITOR_WIDTH), max))
}
