import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HELP_SECTIONS,
  HELP_TOPICS,
  HELP_TOPIC_LABELS,
  START_PROMPTS,
  guideUrl,
  helpPromptText
} from './help'

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
    expect(helpPromptText('start-overview')).toContain('何ができるか')
  })

  it('タブから開く使い方のページの節は、タブの名前（docs/guide.md の見出し）', () => {
    expect(guideUrl('timetable')).toBe(
      'https://github.com/kanjiyamamoto66/mokkan/blob/main/docs/guide.md#%E6%99%82%E9%96%93%E5%89%B2'
    )
  })

  it('docs/guide.md に、どのタブの見出しもある', () => {
    const guide = readFileSync(resolve(__dirname, '../../docs/guide.md'), 'utf8')
    for (const topic of HELP_TOPICS) {
      expect(guide).toMatch(new RegExp(`^## ${HELP_TOPIC_LABELS[topic]}$`, 'm'))
    }
  })

  it('id から文を引く。知らない id は null', () => {
    expect(helpPromptText('calendar-busy-days')).toContain('期限が集中')
    expect(helpPromptText('nope')).toBeNull()
    expect(helpPromptText('__proto__')).toBeNull()
  })
})
