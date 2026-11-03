// 本文の中の、他のチケットやノートへのリンク（標準の md のリンク `[タイトル](../tickets/ID_….md)`）
// アプリはリンク先のファイル名の先頭の ID だけで探すので、ファイル名が変わったり archive/ に移ったりしても開ける

import { ARCHIVE_PREFIX } from './archive'
import { NOTES_PREFIX } from './note'
import { idFromFileName } from './ticket'

/** キー（Ticket.fileName・Note.fileName）が入っているフォルダ（tasks/ の中） */
function folderOf(key: string): string {
  if (key.startsWith(ARCHIVE_PREFIX)) return 'archive'
  if (key.startsWith(NOTES_PREFIX)) return 'notes'
  return 'tickets'
}

function nameOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/**
 * from のファイルから to のファイルへの相対パス（同じフォルダならファイル名だけ、違えば `../フォルダ/ファイル名`）
 * ほかのエディタや GitHub で開いたときもたどれるよう、今のファイル名で書く
 */
export function relativeLinkPath(fromKey: string, toKey: string): string {
  const from = folderOf(fromKey)
  const to = folderOf(toKey)
  return from === to ? nameOf(toKey) : `../${to}/${nameOf(toKey)}`
}

/**
 * md のリンクの `(…)` に書くリンク先。空白や括弧があるときは `<…>` で囲む（CommonMark の書き方）
 * エディタを通さずに書くとき（「宿題」への書き戻し）に使う
 */
export function markdownLinkDestination(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path
}

/**
 * リンク先（href）のファイル名の先頭の ID。他のチケットやノートへのリンクでなければ null
 * http: などの URL や、ID で始まらないファイル名は対象外
 */
export function idFromHref(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  let path = href.split(/[?#]/)[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    // % の書き方が崩れていても、そのまま読む
  }
  return idFromFileName(path.slice(path.lastIndexOf('/') + 1))
}

/** リンクの候補にするファイル（チケット・ノート・アーカイブ） */
export interface LinkTarget {
  fileName: string
  id: string | null
  title: string
  modified: number | null
}

/** 探すために文字を揃える（全角・半角、大文字・小文字、カタカナ・ひらがなを区別しない） */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

/** 一度に出す候補の数 */
const MAX_CANDIDATES = 8

/**
 * `[[` の後ろに打った文字で、リンクの候補を絞り込む。タイトルか ID の部分一致で、最近更新したものを上にする
 * @param excludeKey 今開いているファイル（自分へのリンクは候補に出さない）
 */
export function linkCandidates(
  query: string,
  targets: readonly LinkTarget[],
  excludeKey: string
): LinkTarget[] {
  const q = normalizeForSearch(query.trim())
  return targets
    .filter((t) => t.id && t.fileName !== excludeKey)
    .filter((t) => q === '' || normalizeForSearch(t.title).includes(q) || t.id!.includes(q))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, MAX_CANDIDATES)
}
