// 利用者が使っている AI（AI のアプリ）。アプリから AI を呼ぶことはなく、
// 「はじめに」とヘルプで、AI を mokkan のデータのフォルダで起動するやり方を書き分けるためだけに使う。どれかは個人設定で選ぶ

export const AI_SERVICES = ['claude', 'claude-desktop', 'cursor'] as const
export type AiService = (typeof AI_SERVICES)[number]

/** 設定していないときの AI */
export const DEFAULT_AI_SERVICE: AiService = 'claude'

/** 画面に出す名前 */
export const AI_SERVICE_NAMES: Record<AiService, string> = {
  claude: 'Claude Code（ターミナル）',
  'claude-desktop': 'Claude のデスクトップアプリ（Code）',
  cursor: 'Cursor'
}

/** 知っている AI の名前なら返す。そうでなければ null */
export function asAiService(value: unknown): AiService | null {
  return AI_SERVICES.find((s) => s === value) ?? null
}
