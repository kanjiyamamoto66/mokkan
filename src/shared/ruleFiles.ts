// ルールのファイル（tasks/ に置く RULES.md・テンプレート・AI 向けの案内・skill）の扱いのうち、画面と裏方で共通のもの

/** tasks/ に置く skill（AI の作業の手順）のフォルダ。Claude Code と Cursor がここを読む */
export const SKILLS_DIR = '.claude/skills'

/** tasks/ に置く skill の名前（`.claude/skills/<名前>/SKILL.md`） */
export const SKILL_NAMES = [
  'mokkan-creating-tasks-from-notes',
  'mokkan-ingesting-knowledge',
  'mokkan-reviewing-knowledge',
  'mokkan-writing-project-indexes',
  'mokkan-tidying-tickets',
  'mokkan-planning-days'
] as const
export type SkillName = (typeof SKILL_NAMES)[number]

/** skill のファイルの tasks/ からのパス */
export function skillPath(name: string): string {
  return `${SKILLS_DIR}/${name}/SKILL.md`
}

/** skill のファイルなら、その名前。そうでなければ null */
export function skillNameOf(path: string): string | null {
  const m = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(path)
  return m ? m[1] : null
}

/**
 * RULES.md と skill は、一緒に更新するまとまり。作業の手順を RULES.md から skill に移したので、
 * 片方だけを更新すると、RULES.md の一覧にある手順が見つからない・古い RULES.md と手順が二重になる、が起きる
 */
export function isRuleBundle(path: string): boolean {
  return path === 'RULES.md' || skillNameOf(path) !== null
}

/**
 * 更新するファイルの名前に、一緒に更新するまとまり（RULES.md と skill）を足す
 * @param names 選んだ名前
 * @param all 知っているルールのファイルの名前（この順に並べて返す）
 */
export function withRuleBundle(names: readonly string[], all: readonly string[]): string[] {
  const chosen = new Set(names)
  if (names.some(isRuleBundle)) {
    for (const name of all) if (isRuleBundle(name)) chosen.add(name)
  }
  // 知らない名前も落とさずに後ろに残す（受け付けるかは呼ぶ側が決める）
  return [...all.filter((n) => chosen.has(n)), ...names.filter((n) => !all.includes(n))]
}

/** 設定の画面に出す名前。skill は `skill：名前` にする */
export function ruleFileLabel(path: string): string {
  const skill = skillNameOf(path)
  return skill ? `skill：${skill}` : path
}
