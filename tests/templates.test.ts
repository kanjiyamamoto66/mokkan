import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// RULES.md の「文字コードはUTF-8（BOMなし）、改行はLF」を原本自身が守っているかを確かめる
const TEMPLATES = ['RULES.md', 'TEMPLATE.md', 'NOTE_TEMPLATE.md', 'AI_GUIDE.md']

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
