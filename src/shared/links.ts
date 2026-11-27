// 本文の中の、他のチケットやノートへのリンク（標準の md のリンク `[タイトル](../tickets/ID_….md)`）
// アプリはリンク先のファイル名の先頭の ID だけで探すので、ファイル名が変わったり archive/ に移ったりしても開ける

import { ARCHIVE_PREFIX } from './archive'
import { NOTES_PREFIX } from './note'
import { idFromFileName } from './ticket'

/**
 * キー（Ticket.fileName・Note.fileName）のファイルの、tasks/ からのフォルダの並び
 * `x.md` → [tickets]、`archive/x.md` → [archive]、`notes/案件A/x.md` → [notes, 案件A]
 */
function foldersOf(key: string): string[] {
  if (key.startsWith(ARCHIVE_PREFIX)) return ['archive']
  if (key.startsWith(NOTES_PREFIX)) return key.split('/').slice(0, -1)
  return ['tickets']
}

function nameOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/** キーのファイルの、tasks/ からのパス（`tickets/x.md`・`archive/x.md`・`notes/案件A/x.md`） */
export function tasksPathOf(key: string): string {
  return [...foldersOf(key), nameOf(key)].join('/')
}

/**
 * from のファイルに書いたリンク先（相対パス）が指すファイルの、tasks/ からのパス
 * `?`・`#` から後ろは除き、`%` の書き方は戻す。tasks/ の外を指す・URL・絶対パスなら null
 */
export function resolveLinkPath(fromKey: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  let path = href.split(/[?#]/)[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    // % の書き方が崩れていても、そのまま読む
  }
  if (path.startsWith('/')) return null
  const parts = foldersOf(fromKey)
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

/**
 * from のファイルから to のファイルへの相対パス
 * 同じフォルダならファイル名だけ、違えば `../フォルダ/ファイル名`（notes/ の中のフォルダの深さに合わせて `../` を重ねる）
 * ほかのエディタや GitHub で開いたときもたどれるよう、今のファイル名で書く
 */
export function relativeLinkPath(fromKey: string, toKey: string): string {
  const from = foldersOf(fromKey)
  const to = foldersOf(toKey)
  let same = 0
  while (same < from.length && same < to.length && from[same] === to[same]) same++
  return [...from.slice(same).map(() => '..'), ...to.slice(same), nameOf(toKey)].join('/')
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

/**
 * 外部のブラウザで開いてよい URL か（http と https だけ。file: などは開かない）
 * 本文のリンクを開くとき（画面）と、新しいウィンドウを開く要求を受けたとき（裏方）の両方で確かめる
 */
export function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 文の中の ID（`YYYYMMDD-HHMM-xxxx`）。前後が英数字に続いているものは除く */
const ID_IN_TEXT = /(?<![0-9A-Za-z])\d{8}-\d{4}-[a-z0-9]{4}(?![0-9A-Za-z])/g

export interface IdMatch {
  /** 文字列の中の位置 */
  start: number
  end: number
  id: string
}

/** 文字列の中の ID を探す */
export function findIds(text: string): IdMatch[] {
  return [...text.matchAll(ID_IN_TEXT)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    id: m[0]
  }))
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
