// チケット・ノート・アーカイブの全文検索。探すたびにファイルを読み（裏方）、ここで当たりを判定する
// 本文を持ち続けないので、ファイルだけがデータという決まりはそのまま守れる

import { normalizeForSearch } from './links'
import { ARCHIVE_PREFIX } from './archive'
import { isNoteKey } from './note'
import { splitFrontmatter } from './ticket'

export type SearchKind = 'ticket' | 'note' | 'archive'

export interface SearchHit {
  /** チケット・ノートのキー */
  fileName: string
  title: string
  kind: SearchKind
  /** 当たった箇所の前後の文（1行）。タイトルだけに当たったときは空 */
  snippet: string
  /** タイトルに当たったか（タイトルに当たったものを上に並べる） */
  matchedInTitle: boolean
  /** 編集画面で当たった箇所まで動かすときに探す語（最初の語） */
  term: string
  modified: number | null
}

export interface SearchOptions {
  /** ノートの「文字起こし」も探すか（当たりが増えすぎるので、既定では探さない） */
  includeTranscript: boolean
}

/** 検索の語の数の上限 */
const MAX_TERMS = 8
/** 当たった箇所の前に出す文字数と、全体の文字数 */
const SNIPPET_BEFORE = 30
const SNIPPET_LENGTH = 90

/** 検索の文字列を語に分ける（空白で区切る。全角の空白も）。語は探すための形に揃える */
export function splitTerms(query: string): string[] {
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter((t) => t !== '')
    .slice(0, MAX_TERMS)
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

/** ノートの本文から「文字起こし」の見出しの節（次の同じか上の段の見出しまで）を除く */
export function removeTranscript(body: string): string {
  const lines = body.split('\n')
  const start = lines.findIndex(
    (l) => HEADING.exec(l.replace(/\r$/, ''))?.[2].trim() === '文字起こし'
  )
  if (start < 0) return body
  const level = HEADING.exec(lines[start].replace(/\r$/, ''))![1].length
  let end = start + 1
  while (end < lines.length) {
    const h = HEADING.exec(lines[end].replace(/\r$/, ''))
    if (h && h[1].length <= level) break
    end++
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}

function kindOf(key: string): SearchKind {
  if (key.startsWith(ARCHIVE_PREFIX)) return 'archive'
  return isNoteKey(key) ? 'note' : 'ticket'
}

/** 当たった語のまわりを切り出す */
function snippetAround(line: string, term: string): string {
  const text = line.replace(/\r$/, '').trim()
  // 揃えた形と元の文で文字の位置がずれることがある（全角→半角など）が、目安として使う
  const at = Math.max(0, normalizeForSearch(text).indexOf(term))
  const start = Math.max(0, at - SNIPPET_BEFORE)
  const cut = text.slice(start, start + SNIPPET_LENGTH)
  return `${start > 0 ? '…' : ''}${cut}${start + SNIPPET_LENGTH < text.length ? '…' : ''}`
}

/**
 * 1つのファイルが検索に当たるかを調べる。すべての語がタイトルか本文に含まれていれば当たり
 * 部分一致で、かな・全角半角・大文字小文字を区別しない
 * @param terms splitTerms で分けた語
 */
export function searchFile(
  entry: { fileName: string; title: string; modified: number | null },
  text: string,
  terms: string[],
  options: SearchOptions
): SearchHit | null {
  if (terms.length === 0) return null
  let body = splitFrontmatter(text)?.body ?? text
  if (isNoteKey(entry.fileName) && !options.includeTranscript) body = removeTranscript(body)
  const title = normalizeForSearch(entry.title)
  const normalized = normalizeForSearch(body)
  if (!terms.every((t) => title.includes(t) || normalized.includes(t))) return null

  const lines = body.split('\n')
  // 本文の中で最初の語が出てくる行（タイトルの見出しの行は、タイトルとして出すので飛ばす）
  const isTitleLine = (line: string): boolean => /^#[ \t]/.test(line)
  const first = terms.find((t) => normalized.includes(t)) ?? terms[0]
  const line = lines.find((l) => !isTitleLine(l) && normalizeForSearch(l).includes(first))
  return {
    fileName: entry.fileName,
    title: entry.title,
    kind: kindOf(entry.fileName),
    snippet: line ? snippetAround(line, first) : '',
    matchedInTitle: terms.some((t) => title.includes(t)),
    term: first,
    modified: entry.modified
  }
}

/** 当たりの並び順。タイトルに当たったものを上に、同じなら最近更新したものを上にする */
export function compareHits(a: SearchHit, b: SearchHit): number {
  if (a.matchedInTitle !== b.matchedInTitle) return a.matchedInTitle ? -1 : 1
  return (b.modified ?? 0) - (a.modified ?? 0)
}
