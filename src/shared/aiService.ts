// 「AI でタスクを起こす」で呼ぶ AI（パソコンに入っている AI ツール）。どれを使うかは個人設定で選ぶ
// 裏方（呼び方）と画面（名前・案内）の両方から使う

export const AI_SERVICES = ['claude', 'cursor'] as const
export type AiService = (typeof AI_SERVICES)[number]

/** 設定していないときに使う AI */
export const DEFAULT_AI_SERVICE: AiService = 'claude'

/** 画面に出す名前 */
export const AI_SERVICE_NAMES: Record<AiService, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor'
}

/** 試験中の AI（実物でまだ十分に確かめていないもの）。設定の選択肢に「（試験中）」と出す */
export const EXPERIMENTAL_AI_SERVICES: readonly AiService[] = ['cursor']

/** 設定の選択肢に出す名前 */
export function aiServiceOptionLabel(service: AiService): string {
  return (
    AI_SERVICE_NAMES[service] + (EXPERIMENTAL_AI_SERVICES.includes(service) ? '（試験中）' : '')
  )
}

/** 見つからないときの案内（入れ方とログイン） */
export const AI_SERVICE_INSTALL_HINTS: Record<AiService, string> = {
  claude:
    'Claude Code（claude コマンド）が見つかりません。Claude Code をインストールしてログインしてから、もう一度試してください。',
  cursor:
    'Cursor CLI（agent コマンド）が見つかりません。Cursor CLI をインストールし、ターミナルで agent login を実行してログインしてから、もう一度試してください。'
}

/** 知っている AI の名前なら返す。そうでなければ null */
export function asAiService(value: unknown): AiService | null {
  return AI_SERVICES.find((s) => s === value) ?? null
}
