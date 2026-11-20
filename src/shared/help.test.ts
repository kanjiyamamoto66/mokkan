import { describe, expect, it } from 'vitest'
import { HELP_SECTIONS, HELP_TOPICS, START_PROMPTS, helpPromptText } from './help'

describe('ヘルプ', () => {
  it('どの画面にも、操作と AI に頼む文がある', () => {
    for (const topic of HELP_TOPICS) {
      if (topic === 'start') continue
      expect(HELP_SECTIONS[topic].actions.length).toBeGreaterThan(0)
      expect(HELP_SECTIONS[topic].prompts.length).toBeGreaterThan(0)
    }
  })

  it('AI に頼む文の id は重ならない', () => {
    const ids = [
      ...START_PROMPTS.map((p) => p.id),
      ...Object.values(HELP_SECTIONS).flatMap((s) => s.prompts.map((p) => p.id))
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('はじめにの文も引ける', () => {
    expect(helpPromptText('start-rules')).toContain('RULES.md')
  })

  it('id から文を引く。知らない id は null', () => {
    expect(helpPromptText('calendar-busy-days')).toContain('期限が集中')
    expect(helpPromptText('nope')).toBeNull()
    expect(helpPromptText('__proto__')).toBeNull()
  })
})
