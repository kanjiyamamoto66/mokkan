// frontmatter の書き換え。変わった項目の行だけを書き換え、ほかの行は1文字も変えない

import { parse } from 'yaml'
import { splitFrontmatter } from './ticket'

/** RULES.md の項目と、その並び順 */
export const FIELD_ORDER = [
  'id',
  'status',
  'priority',
  'start',
  'due',
  'repeat',
  'tags',
  'parent',
  'source',
  'assignee',
  'author',
  'created',
  'done'
] as const

/** RULES.md「ノート」の項目と、その並び順 */
export const NOTE_FIELD_ORDER = ['id', 'date', 'tags', 'author', 'created'] as const

export type FieldKey = (typeof FIELD_ORDER)[number] | (typeof NOTE_FIELD_ORDER)[number]
/** 項目の値。null は空（`項目:` の行だけ残す） */
export type FieldValue = string | number | string[] | null
export type FieldUpdates = Partial<Record<FieldKey, FieldValue>>

/** YAML として書いても同じ値に読める文字列なら、そのまま書く。そうでなければ "..." で囲む */
function scalar(value: string): string {
  try {
    if (value.trim() === value && value !== '' && parse(`v: ${value}`)?.v === value) return value
  } catch {
    // 読めない書き方なら囲む
  }
  return JSON.stringify(value)
}

function flowItem(value: string): string {
  try {
    const parsed = parse(`v: [${value}]`)?.v
    if (
      value.trim() === value &&
      Array.isArray(parsed) &&
      parsed.length === 1 &&
      parsed[0] === value
    ) {
      return value
    }
  } catch {
    // 読めない書き方なら囲む
  }
  return JSON.stringify(value)
}

/** 1行分の `項目: 値` を作る。タグは RULES.md の例と同じ `[タグ1, タグ2]` の形にする */
export function formatField(key: FieldKey, value: FieldValue): string {
  if (Array.isArray(value)) return `${key}: [${value.map(flowItem).join(', ')}]`
  if (value === null || value === '') return `${key}:`
  if (typeof value === 'number') return `${key}: ${value}`
  return `${key}: ${scalar(value)}`
}

/**
 * 担当者を書く値にする。1人なら文字列、2人以上ならリスト、0人なら空
 * 今のファイル（1人の文字列）も AI の手順もそのまま使えるよう、リストは2人以上のときだけにする
 */
export function assigneeField(names: readonly string[]): FieldValue {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ''))]
  if (unique.length === 0) return null
  return unique.length === 1 ? unique[0] : unique
}

/** normalize した値どうしを比べる（null・数値・文字列・文字列の配列だけなので JSON で足りる） */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 比べるために値を揃える（空の文字列・空の配列・null は同じ扱い） */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) return value.length === 0 ? null : value.map((v) => String(v))
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return typeof value === 'number' ? value : String(value)
}

/**
 * frontmatter の指定した項目だけを書き換える
 * - 値が今と同じ項目は書き換えない
 * - 項目の行がなければ、RULES.md の並び順の位置に足す
 * - order にない項目は書き換えない（ノートは NOTE_FIELD_ORDER を渡す）
 * - 値が複数行にわたる項目（`tags:` の下に `- a` が続くなど）は、続きの行もまとめて置き換える
 * @throws frontmatter がないとき
 */
export function setFields(
  text: string,
  updates: FieldUpdates,
  order: readonly FieldKey[] = FIELD_ORDER
): string {
  const open = /^---\r?\n/.exec(text)
  const split = splitFrontmatter(text)
  if (!open || !split) throw new Error('frontmatter がありません')

  const newline = split.frontmatter.includes('\r\n') ? '\r\n' : '\n'
  let current: Record<string, unknown> = {}
  try {
    const parsed = parse(split.frontmatter)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
  } catch {
    // 読めない frontmatter でも、行の置き換えはできる
  }

  // 行ごとに改行コードも持つ（書き換えない行は改行コードも元のまま残す）
  const rawLines = split.frontmatter.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const lines = rawLines.map((l) => l.replace(/\r?\n$/, ''))
  const endings = rawLines.map((l) => /\r?\n$/.exec(l)?.[0] ?? newline)

  const findLine = (key: string): number => lines.findIndex((l) => l.startsWith(`${key}:`))

  let changed = false
  for (const key of order) {
    if (!(key in updates)) continue
    const value = updates[key] ?? null
    if (sameValue(normalize(current[key]), normalize(value))) continue

    const line = formatField(key, value)
    const index = findLine(key)
    if (index >= 0) {
      // 値の続きの行（字下げした行や `- ` で始まる行）も含めて置き換える
      let end = index + 1
      while (end < lines.length && /^([ \t]|-([ \t]|$))/.test(lines[end])) end++
      lines.splice(index, end - index, line)
      endings.splice(index, end - index, endings[index])
    } else {
      // 並び順で前にある項目のうち、一番近いものの後ろに足す
      const before = order
        .slice(0, order.indexOf(key))
        .map(findLine)
        .filter((i) => i >= 0)
      const at = before.length > 0 ? Math.max(...before) + 1 : 0
      let insertAt = at
      while (insertAt < lines.length && /^([ \t]|-([ \t]|$))/.test(lines[insertAt])) insertAt++
      lines.splice(insertAt, 0, line)
      endings.splice(insertAt, 0, newline)
    }
    changed = true
  }
  if (!changed) return text

  const start = open[0].length
  const end = start + split.frontmatter.length
  const frontmatter = lines.map((l, i) => l + endings[i]).join('')
  return text.slice(0, start) + frontmatter + text.slice(end)
}

/** frontmatter はそのままで本文だけを差し替える。frontmatter がなければ全体を本文とみなす */
export function replaceBody(text: string, body: string): string {
  const split = splitFrontmatter(text)
  if (!split) return body
  return text.slice(0, text.length - split.body.length) + body
}
