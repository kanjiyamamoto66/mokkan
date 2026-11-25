import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { SKILL_NAMES } from '../src/shared/ruleFiles'

// RULES.md の「文字コードはUTF-8（BOMなし）、改行はLF」を原本自身が守っているかを確かめる
const TEMPLATES = [
  'RULES.md',
  'TEMPLATE.md',
  'NOTE_TEMPLATE.md',
  'AI_GUIDE.md',
  'samples/notes/meeting.md',
  'samples/notes/howto.md',
  'samples/notes/reference.md',
  'samples/notes/explanation.md',
  'samples/notes/index.md',
  'skills/mokkan-creating-tasks-from-notes/SKILL.md',
  'skills/mokkan-ingesting-knowledge/SKILL.md',
  'skills/mokkan-reviewing-knowledge/SKILL.md',
  'skills/mokkan-writing-project-indexes/SKILL.md',
  'skills/mokkan-tidying-tickets/SKILL.md',
  'skills/mokkan-planning-days/SKILL.md'
]

describe.each(TEMPLATES)('templates/%s', (name) => {
  const bytes = readFileSync(resolve(__dirname, '../templates', name))

  it('BOMが付いていない', () => {
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false)
  })

  it('改行がLFだけである', () => {
    expect(bytes.includes(0x0d)).toBe(false)
  })

  it('UTF-8として正しく読める', () => {
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow()
  })
})

// skill は Agent Skills の形にし、公式のベストプラクティスの決まりを守る
// （https://platform.claude.com/docs/ja/agents-and-tools/agent-skills/best-practices）
describe.each(SKILL_NAMES)('templates/skills/%s', (name) => {
  const text = readFileSync(resolve(__dirname, '../templates/skills', name, 'SKILL.md'), 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  // YAML として読む（正規表現で行を抜き出すだけだと、`type: record` のような「コロン＋空白」で
  // YAML が壊れていても気づけない。厳密に読む道具では skill が読み込まれなくなる）
  const data = parse(frontmatter) as Record<string, unknown>
  const description = typeof data.description === 'string' ? data.description : ''

  it('frontmatter が YAML として読め、name と description が文字列', () => {
    expect(typeof data.name).toBe('string')
    expect(typeof data.description).toBe('string')
  })

  it('name がフォルダの名前と同じで、決まりに合う', () => {
    expect(data.name).toBe(name)
    // 64文字まで・英小文字と数字とハイフンだけ・予約語（anthropic・claude）を含まない
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^[a-z0-9-]+$/)
    expect(name).not.toMatch(/anthropic|claude/)
    // まとまりの中で名前の形をそろえる（mokkan- と動名詞）
    expect(name).toMatch(/^mokkan-[a-z]+ing(-|$)/)
  })

  it('description は、何をするかと、いつ使うかを書く（1024文字まで・XML のタグなし）', () => {
    expect(description.length).toBeGreaterThan(20)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(description).not.toMatch(/<[^>]+>/)
    expect(description).toMatch(/ときに使う。$/)
  })

  it('本文は500行未満で、進み具合のチェックリストがある', () => {
    expect(text.split('\n').length).toBeLessThan(500)
    expect(text).toMatch(/^- \[ \] 1\. /m)
  })

  it('言葉をそろえる：「確かめる」は人に確かめる（人の了承）ことだけに使い、書いた後の点検は「見直す」', () => {
    for (const line of text.split('\n').filter((l) => l.includes('確かめ'))) {
      expect(line).toMatch(/人[にが]確かめ|確かめる前に|確かめるまで/)
    }
  })

  it('パスの区切りは / だけ（Windows の \\ を使わない）', () => {
    expect(text).not.toMatch(/[a-z0-9_.]\\[a-z0-9_]/i)
    // 確かめ方そのものが働くこと（バックスラッシュのパスを見つけられる）
    expect('tickets\\x.md').toMatch(/[a-z0-9_.]\\[a-z0-9_]/i)
  })

  it('RULES.md の一覧に載っている', () => {
    const rules = readFileSync(resolve(__dirname, '../templates/RULES.md'), 'utf8')
    expect(rules).toContain(`.claude/skills/${name}/SKILL.md`)
  })
})
