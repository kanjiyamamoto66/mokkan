// タグの色。色相（0〜359）だけを tasks/TAGS.md の frontmatter に保存し、鮮やかさと明るさは画面が一定にする
// （色の意味の決まりは docs/spec.md「色の意味」。タグに赤を選んでも淡い赤になり、優先度の高と見分けられる）

import { parse } from 'yaml'
import { splitFrontmatter } from './ticket'

/** タグの色を書くファイル（tasks/ 直下） */
export const TAGS_FILE = 'TAGS.md'

/** タグの名前 → 色相。選んでいないタグは入らない */
export type TagColors = Record<string, number>

/** 新しく TAGS.md を作るときの中身 */
export const TAGS_TEMPLATE = `---
colors:
---

# タグの色

mokkan がタグの色（色相、0〜359）を書き込むファイルです。色を選んでいないタグは、名前から自動で色を決めます。

- 人や AI が書き換える必要はありません。
- 表示するときは、鮮やかさと明るさをアプリが一定にして、淡い色（パステル調）にします。
`

/** 色見本に並べる色相（12色） */
export const SWATCH_HUES: readonly number[] = [
  0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330
]

/** 同期サービスの競合コピー（`TAGS (1).md` など）か */
export function isTagsConflictFileName(name: string): boolean {
  return name !== TAGS_FILE && /^TAGS[ _(-].*\.md$/i.test(name)
}

/** 0〜359 の整数に揃える。数でなければ null */
export function normalizeHue(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return ((Math.round(n) % 360) + 360) % 360
}

/** TAGS.md からタグの色を読む。書き換えは一切しない */
export function parseTagColors(text: string): { colors: TagColors; error: string | null } {
  const split = splitFrontmatter(text)
  if (!split) return { colors: {}, error: `${TAGS_FILE} に frontmatter がありません` }
  let data: unknown
  try {
    data = parse(split.frontmatter)
  } catch (error) {
    return {
      colors: {},
      error: `${TAGS_FILE} を読めません：${(error as Error).message.split('\n')[0]}`
    }
  }
  const raw = (data as Record<string, unknown> | null)?.colors
  if (raw === null || raw === undefined) return { colors: {}, error: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { colors: {}, error: `${TAGS_FILE} の colors が「タグ: 色相」の形になっていません` }
  }
  const colors: TagColors = {}
  for (const [tag, value] of Object.entries(raw)) {
    const hue = normalizeHue(value)
    if (hue !== null && tag.trim() !== '') colors[tag.trim()] = hue
  }
  return { colors, error: null }
}

/** YAML のキーとして書いても同じ名前に読めるなら、そのまま書く。そうでなければ "..." で囲む */
function keyScalar(key: string): string {
  try {
    const parsed = parse(`${key}: 0`)
    if (
      key.trim() === key &&
      parsed &&
      typeof parsed === 'object' &&
      Object.keys(parsed).length === 1 &&
      Object.keys(parsed)[0] === key
    ) {
      return key
    }
  } catch {
    // 読めない書き方なら囲む
  }
  return JSON.stringify(key)
}

/** `  キー: 値` の行のキーを読む。読めなければ null */
function lineKey(line: string): string | null {
  try {
    const parsed = parse(line.trim())
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      return keys.length === 1 ? keys[0] : null
    }
  } catch {
    // 読めない行は対象外
  }
  return null
}

/**
 * TAGS.md の、指定したタグの色の行だけを書き換える（ほかの行は1文字も変えない）
 * @param text 今の TAGS.md の中身。ファイルがなければ null（テンプレートから作る）
 * @param hue 色相。null なら色の指定を外す（自動の色に戻す）
 * @throws frontmatter がない・colors が「タグ: 色相」の形でないとき
 */
export function setTagColorText(text: string | null, tag: string, hue: number | null): string {
  const source = text ?? TAGS_TEMPLATE
  const open = /^---\r?\n/.exec(source)
  const split = splitFrontmatter(source)
  if (!open || !split) throw new Error(`${TAGS_FILE} に frontmatter がありません`)

  const newline = split.frontmatter.includes('\r\n') ? '\r\n' : '\n'
  const rawLines = split.frontmatter.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const lines = rawLines.map((l) => l.replace(/\r?\n$/, ''))
  const endings = rawLines.map((l) => /\r?\n$/.exec(l)?.[0] ?? newline)
  const entry = (indent: string): string => `${indent}${keyScalar(tag)}: ${hue}`

  let colorsLine = lines.findIndex((l) => /^colors:/.test(l))
  if (colorsLine >= 0) {
    const inline = lines[colorsLine].slice('colors:'.length).trim()
    if (inline === '{}') {
      // 色がない。外す操作なら何も変えない
      if (hue === null) return source
      lines[colorsLine] = 'colors:'
    } else if (inline !== '' && !inline.startsWith('#')) {
      throw new Error(`${TAGS_FILE} の colors の書き方が違うので、色を書き込めません`)
    }
  } else {
    if (hue === null) return source
    lines.push('colors:')
    endings.push(newline)
    colorsLine = lines.length - 1
  }

  // colors: の下の字下げした行（空行をはさんでもよい）
  let end = colorsLine + 1
  while (end < lines.length && (/^[ \t]/.test(lines[end]) || lines[end].trim() === '')) end++
  while (end > colorsLine + 1 && lines[end - 1].trim() === '') end--
  const block = Array.from({ length: end - colorsLine - 1 }, (_, i) => colorsLine + 1 + i)
  const target = block.find((i) => lineKey(lines[i]) === tag)

  if (hue === null) {
    if (target === undefined) return source
    lines.splice(target, 1)
    endings.splice(target, 1)
  } else if (target !== undefined) {
    const indent = /^[ \t]*/.exec(lines[target])![0]
    const line = entry(indent)
    if (line === lines[target]) return source
    lines[target] = line
  } else {
    const indent = block.length > 0 ? /^[ \t]*/.exec(lines[block[0]])![0] || '  ' : '  '
    lines.splice(end, 0, entry(indent))
    endings.splice(end, 0, newline)
  }

  const start = open[0].length
  const stop = start + split.frontmatter.length
  return source.slice(0, start) + lines.map((l, i) => l + endings[i]).join('') + source.slice(stop)
}

/** 色を選んでいないタグの色相。名前から決めるので、同じタグはどの PC でも同じ色になる */
export function autoHue(tag: string): number {
  let hash = 0
  for (const ch of tag) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  // 近すぎる色を減らすため、15度刻みにする
  return (hash % 24) * 15
}

/** タグの色相（選んだ色、なければ名前から決めた色） */
export function tagHue(tag: string, colors: TagColors): number {
  return colors[tag] ?? autoHue(tag)
}
