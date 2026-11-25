import { describe, expect, it } from 'vitest'
import { isRuleBundle, ruleFileLabel, skillNameOf, skillPath, withRuleBundle } from './ruleFiles'

const ALL = [
  'RULES.md',
  'TEMPLATE.md',
  'CLAUDE.md',
  skillPath('mokkan-creating-tasks-from-notes'),
  skillPath('mokkan-tidying-tickets'),
  'templates/notes/議事メモ.md'
]

describe('ルールのファイル', () => {
  it('skill のパスと名前を行き来する', () => {
    expect(skillPath('mokkan-tidying-tickets')).toBe(
      '.claude/skills/mokkan-tidying-tickets/SKILL.md'
    )
    expect(skillNameOf('.claude/skills/mokkan-tidying-tickets/SKILL.md')).toBe(
      'mokkan-tidying-tickets'
    )
    expect(skillNameOf('.claude/skills/a/b/SKILL.md')).toBeNull()
    expect(skillNameOf('RULES.md')).toBeNull()
  })

  it('RULES.md と skill だけが一緒に更新するまとまり', () => {
    expect(isRuleBundle('RULES.md')).toBe(true)
    expect(isRuleBundle(skillPath('mokkan-creating-tasks-from-notes'))).toBe(true)
    expect(isRuleBundle('CLAUDE.md')).toBe(false)
    expect(isRuleBundle('templates/notes/議事メモ.md')).toBe(false)
  })

  it('RULES.md か skill を選ぶと、まとまりをすべて足す', () => {
    expect(withRuleBundle(['RULES.md'], ALL)).toEqual([
      'RULES.md',
      skillPath('mokkan-creating-tasks-from-notes'),
      skillPath('mokkan-tidying-tickets')
    ])
    expect(withRuleBundle([skillPath('mokkan-tidying-tickets'), 'CLAUDE.md'], ALL)).toEqual([
      'RULES.md',
      'CLAUDE.md',
      skillPath('mokkan-creating-tasks-from-notes'),
      skillPath('mokkan-tidying-tickets')
    ])
  })

  it('まとまりを選ばなければそのまま。知らない名前も残す', () => {
    expect(withRuleBundle(['TEMPLATE.md'], ALL)).toEqual(['TEMPLATE.md'])
    expect(withRuleBundle(['../x.md', 'TEMPLATE.md'], ALL)).toEqual(['TEMPLATE.md', '../x.md'])
  })

  it('設定の画面では skill を名前で出す', () => {
    expect(ruleFileLabel(skillPath('mokkan-tidying-tickets'))).toBe('skill：mokkan-tidying-tickets')
    expect(ruleFileLabel('RULES.md')).toBe('RULES.md')
  })
})
