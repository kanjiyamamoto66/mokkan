import { describe, expect, it } from 'vitest'
import {
  TAGS_TEMPLATE,
  autoHue,
  isTagsConflictFileName,
  normalizeHue,
  parseTagColors,
  setTagColorText,
  tagHue
} from './tagColor'

describe('parseTagColors', () => {
  it('colors の「タグ: 色相」を読む。0〜359 に揃え、数でない値は無視する', () => {
    const text = '---\ncolors:\n  仕事: 210\n  家: 390\n  変: あ\n---\n\n# タグの色\n'
    expect(parseTagColors(text)).toEqual({ colors: { 仕事: 210, 家: 30 }, error: null })
  })

  it('テンプレート（colors が空）は色なし', () => {
    expect(parseTagColors(TAGS_TEMPLATE)).toEqual({ colors: {}, error: null })
  })

  it('読めないときは理由を返す', () => {
    expect(parseTagColors('# タグの色\n').error).toContain('frontmatter')
    expect(parseTagColors('---\ncolors: [a]\n---\n').error).toContain('colors')
  })
})

describe('setTagColorText', () => {
  const base = '---\ncolors:\n  仕事: 210\n  家: 30\n---\n\n# タグの色\n\n説明\n'

  it('ファイルがなければテンプレートから作る', () => {
    const text = setTagColorText(null, '仕事', 210)
    expect(text.startsWith('---\ncolors:\n  仕事: 210\n---\n')).toBe(true)
    expect(text.endsWith(TAGS_TEMPLATE.slice(TAGS_TEMPLATE.indexOf('\n---\n') + 5))).toBe(true)
  })

  it('変えたタグの行だけを書き換え、ほかの行は変えない', () => {
    expect(setTagColorText(base, '家', 120)).toBe(
      '---\ncolors:\n  仕事: 210\n  家: 120\n---\n\n# タグの色\n\n説明\n'
    )
  })

  it('ないタグは colors の最後に足す', () => {
    expect(setTagColorText(base, 'A社', 300)).toBe(
      '---\ncolors:\n  仕事: 210\n  家: 30\n  A社: 300\n---\n\n# タグの色\n\n説明\n'
    )
  })

  it('null を渡すと、そのタグの行を消す（自動の色に戻す）', () => {
    expect(setTagColorText(base, '仕事', null)).toBe(
      '---\ncolors:\n  家: 30\n---\n\n# タグの色\n\n説明\n'
    )
    expect(setTagColorText(base, 'ない', null)).toBe(base)
  })

  it('同じ値なら変えない。CRLF の改行も保つ', () => {
    expect(setTagColorText(base, '仕事', 210)).toBe(base)
    const crlf = '---\r\ncolors:\r\n  仕事: 210\r\n---\r\n'
    expect(setTagColorText(crlf, '家', 30)).toBe(
      '---\r\ncolors:\r\n  仕事: 210\r\n  家: 30\r\n---\r\n'
    )
  })

  it('YAML で特別な意味を持つ名前は囲んで書き、読み直すと同じ名前になる', () => {
    const text = setTagColorText(base, 'a: b', 90)
    expect(text).toContain('  "a: b": 90\n')
    expect(parseTagColors(text).colors['a: b']).toBe(90)
    expect(parseTagColors(setTagColorText(text, 'a: b', 45)).colors['a: b']).toBe(45)
  })

  it('colors の行がなければ足す。{} は空のリストとして扱う', () => {
    expect(setTagColorText('---\nnote: x\n---\n', '仕事', 0)).toBe(
      '---\nnote: x\ncolors:\n  仕事: 0\n---\n'
    )
    expect(setTagColorText('---\ncolors: {}\n---\n', '仕事', 0)).toBe(
      '---\ncolors:\n  仕事: 0\n---\n'
    )
    // 外す操作では、色がなければ何も変えない
    expect(setTagColorText('---\ncolors: {}\n---\n', '仕事', null)).toBe('---\ncolors: {}\n---\n')
    expect(setTagColorText('---\nnote: x\n---\n', '仕事', null)).toBe('---\nnote: x\n---\n')
  })

  it('colors の書き方が違うときは書き込まない', () => {
    expect(() => setTagColorText('---\ncolors: [a]\n---\n', '仕事', 0)).toThrow()
  })
})

describe('色相', () => {
  it('選んでいないタグは名前から決める（同じ名前は同じ色、15度刻み）', () => {
    expect(autoHue('仕事')).toBe(autoHue('仕事'))
    expect(autoHue('仕事') % 15).toBe(0)
    expect(tagHue('仕事', {})).toBe(autoHue('仕事'))
    expect(tagHue('仕事', { 仕事: 7 })).toBe(7)
  })

  it('normalizeHue', () => {
    expect(normalizeHue(-30)).toBe(330)
    expect(normalizeHue('200')).toBe(200)
    expect(normalizeHue('x')).toBeNull()
    expect(normalizeHue(null)).toBeNull()
  })

  it('同期サービスの競合コピーの名前を見分ける', () => {
    expect(isTagsConflictFileName('TAGS (1).md')).toBe(true)
    expect(isTagsConflictFileName('TAGS.md')).toBe(false)
    expect(isTagsConflictFileName('TAGSX.md')).toBe(false)
  })
})
