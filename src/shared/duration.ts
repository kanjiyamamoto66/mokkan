// 所要時間（チケットの estimate）の書き方。`30m`・`1h`・`1h30m`（RULES.md の「frontmatterの項目」）

/** 所要時間の上限（打ち間違いで極端な値にならないように。1日分） */
export const MAX_ESTIMATE = 24 * 60

/** 所要時間（`30m`・`1h`・`1h30m`・`90m`）を分にする。読めない・0分・1日より長いなら null */
export function parseDuration(text: string | null): number | null {
  if (text === null) return null
  const m = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?$/.exec(text.trim().toLowerCase())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  const minutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  return minutes > 0 && minutes <= MAX_ESTIMATE ? minutes : null
}

/** 分を所要時間の書き方にする（`45m`・`2h`・`1h30m`） */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h${m}m`
}

/** 画面に出す所要時間（`30分`・`1時間`・`1時間30分`） */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}分`
  return m === 0 ? `${h}時間` : `${h}時間${m}分`
}
