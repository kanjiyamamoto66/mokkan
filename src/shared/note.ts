// ノート（tasks/notes/ の1ファイル）の読み取り・一覧・宿題への書き戻しなど、ファイルや画面に依存しない処理
// 裏方（main）と画面（renderer）の両方から使う

import { parse } from 'yaml'
import { replaceBody } from './frontmatter'
import { validDate } from './schedule'
import {
  asString,
  asTags,
  idFromFileName,
  splitFrontmatter,
  titleFromBody,
  type Ticket
} from './ticket'

/** ノートを置くフォルダの名前（tasks/ の中） */
export const NOTES_DIR = 'notes'
/** ノートのキー（Note.fileName）の頭 */
export const NOTES_PREFIX = `${NOTES_DIR}/`

export interface Note {
  /** ノートを表すキー。`notes/ファイル名`（画面と裏方の間で、どのファイルかを指すのに使う） */
  fileName: string
  /** ファイル名の先頭から読んだID。IDで始まらない名前なら null */
  fileId: string | null
  /** frontmatter の id */
  id: string | null
  title: string
  /** 会議などの日 */
  date: string | null
  tags: string[]
  author: string | null
  created: string | null
  /** ファイルの更新日時（ミリ秒）。裏方がファイルから読んだときだけ入る */
  modified: number | null
  /** frontmatter が読めなかったときの理由 */
  parseError: string | null
}

/** ノートのキーか */
export function isNoteKey(key: string): boolean {
  return key.startsWith(NOTES_PREFIX)
}

/**
 * キーと中身からノートを読み取る。書き換えは一切しない
 * @param key `notes/ファイル名`（ファイル名だけでもよい）
 */
export function parseNote(key: string, text: string): Note {
  const name = isNoteKey(key) ? key.slice(NOTES_PREFIX.length) : key
  const note: Note = {
    fileName: isNoteKey(key) ? key : NOTES_PREFIX + key,
    fileId: idFromFileName(name),
    id: null,
    title: '',
    date: null,
    tags: [],
    author: null,
    created: null,
    modified: null,
    parseError: null
  }

  const split = splitFrontmatter(text)
  if (!split) {
    note.parseError = 'frontmatter（先頭の --- で囲んだ部分）がありません'
    note.title = titleFromBody(text)
    return note
  }
  note.title = titleFromBody(split.body)

  let data: unknown
  try {
    data = parse(split.frontmatter)
  } catch (error) {
    note.parseError = `frontmatter を読めません：${(error as Error).message.split('\n')[0]}`
    return note
  }
  if (data === null || data === undefined) data = {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    note.parseError = 'frontmatter が「項目: 値」の形になっていません'
    return note
  }

  const fm = data as Record<string, unknown>
  note.id = asString(fm.id)
  note.date = asString(fm.date)
  note.tags = asTags(fm.tags)
  note.author = asString(fm.author)
  note.created = asString(fm.created)
  return note
}

/** 一覧の並べ替えに使う日付。`date` がなければ `created` */
export function noteDate(note: Note): string | null {
  return validDate(note.date) ?? validDate(note.created)
}

/**
 * ノートの一覧に出すノートを返す。日付の新しい順（日付のないものは最後）、同じ日は ID の新しい順
 * @param tags タグの絞り込み（一覧・カレンダー・ガントと共通）。空なら絞り込まない
 */
export function listNotes(notes: Note[], tags: string[]): Note[] {
  return notes
    .filter((n) => tags.length === 0 || n.tags.some((t) => tags.includes(t)))
    .sort((a, b) => {
      const da = noteDate(a)
      const db = noteDate(b)
      if (da !== db) {
        if (da === null) return 1
        if (db === null) return -1
        return da < db ? 1 : -1
      }
      return (b.id ?? b.fileName).localeCompare(a.id ?? a.fileName)
    })
}

/** このノートから起こしたチケット（`source` がこのノートの id のもの）。アーカイブしたものも含む */
export function ticketsFromNote(note: Note, tickets: Ticket[]): Ticket[] {
  if (!note.id) return []
  return tickets.filter((t) => t.source === note.id)
}

// ---- 宿題への書き戻し ----

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const LIST_ITEM = /^ {0,3}[-*+][ \t]/

interface HeadingLine {
  index: number
  level: number
  text: string
}

/** 本文の見出しの行を返す（コードブロックの中は除く） */
function headings(lines: string[]): HeadingLine[] {
  const result: HeadingLine[] = []
  let fence: string | null = null
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1]
    if (marker) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      return
    }
    if (fence !== null) return
    const match = HEADING.exec(line)
    if (match) result.push({ index, level: match[1].length, text: match[2].trim() })
  })
  return result
}

/** 「宿題」の項目に付け足した「→ チケットへのリンク」があるか（`→ ID` と `→ [ID](…)` のどちらも） */
const BACK_LINK = /→\s*(?:\[[^\]]*\]\([^)]*\)|<[^>]*>|\d{8}-\d{4}-[a-z0-9]{4})/

/** 「宿題」の項目に、すでに「→ チケット」が付いているか */
export function hasBackLink(text: string): boolean {
  return BACK_LINK.test(text)
}

/**
 * 箇条書きの1行から、書式を除いた文を取り出す（エディタの項目の文と比べるため）
 * `- [ ] **見積書**を送る` → `見積書を送る`
 */
export function plainListItem(line: string): string {
  // `\*` のようなエスケープした文字は、書式の記号として消さないよう、いったん別の文字に置き換えておく
  const escaped: string[] = []
  return (
    line
      .replace(/\r$/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, (_, ch: string) => {
        escaped.push(ch)
        return ''
      })
      // リンクは文字だけにする（リンク先が <…> で囲まれていて括弧を含むものも）
      .replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, '$1')
      .replace(/<((?:https?:|mailto:)[^>]*)>/g, '$1')
      // 書式の記号は対になっているものだけ消す（snake_case のような単語の中の _ は残す）
      .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, '$2')
      .replace(/(?<![\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu, '$1')
      .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(//g, () => escaped.shift() ?? '')
      .trim()
  )
}

/**
 * 「宿題」の項目の文から、チケットのタイトルと担当者を取り出す（RULES.md の手順と同じく担当者を拾う）
 * `見積書を送る（高橋・田中）` → タイトル `見積書を送る`、担当者 `[高橋, 田中]`
 */
export function parseHomeworkItem(text: string): { title: string; assignees: string[] } {
  const withoutLink = text.replace(new RegExp(`\\s*${BACK_LINK.source}.*$`), '').trim()
  const match = /^(.*?)\s*[（(]([^（）()]+)[）)]$/.exec(withoutLink)
  if (!match || match[1].trim() === '') return { title: withoutLink, assignees: [] }
  const assignees = match[2]
    .split(/[、,，・/／]/)
    .map((n) => n.trim())
    .filter((n) => n !== '')
  return { title: match[1].trim(), assignees }
}

/**
 * ノートの「宿題」の、文が itemText の項目の行末に suffix（` → [ID](…)`）を付ける
 * 同じ文の項目が複数あるときは、まだ「→」の付いていない最初の項目にする
 * 付けた suffix のほかは1文字も変えない
 * @returns 書き換えた中身。「宿題」にその項目がない・すでに「→」が付いているときは null（呼ぶ側で新しい行を足す）
 */
export function attachHomework(text: string, itemText: string, suffix: string): string | null {
  const body = splitFrontmatter(text)?.body ?? text
  const lines = body.split('\n')
  const plain = (line: string): string => line.replace(/\r$/, '')
  const all = headings(lines.map(plain))
  const homework = all.find((h) => h.text === '宿題')
  if (!homework) return null
  const end =
    all.find((h) => h.index > homework.index && h.level <= homework.level)?.index ?? lines.length
  const target = itemText.trim()
  for (let i = homework.index + 1; i < end; i++) {
    const line = plain(lines[i])
    if (!LIST_ITEM.test(line) && !/^ {0,3}\d+[.)][ \t]/.test(line)) continue
    if (BACK_LINK.test(line)) continue
    if (plainListItem(line) !== target) continue
    // 行末の空白も残し、その後ろに付ける（付けたもののほかは1文字も変えない）
    const cr = lines[i].endsWith('\r') ? '\r' : ''
    lines[i] = `${line}${suffix}${cr}`
    return replaceBody(text, lines.join('\n'))
  }
  return null
}

/**
 * ノートの「宿題」の最後に、箇条書きの1行（`- item`）を足す（RULES.md「議事メモからタスクを起こす」）
 * - 「宿題」の見出しがなければ、「文字起こし」の見出しの前（なければ本文の最後）に見出しごと足す
 * - 足した行のほかは1文字も変えない（本文の最後に足すときだけ、末尾の空行を1つにまとめる）
 */
export function appendHomework(text: string, item: string): string {
  const body = splitFrontmatter(text)?.body ?? text
  const crlf = body.includes('\r\n')
  // 行の末尾の \r は行に残したまま扱い、足す行にも同じ改行を付ける
  const lines = body.split('\n')
  const cr = crlf ? '\r' : ''
  const plain = (line: string): string => line.replace(/\r$/, '')
  const blank = (line: string): boolean => plain(line).trim() === ''
  const entry = `- ${item}${cr}`

  const all = headings(lines.map(plain))
  const homework = all.find((h) => h.text === '宿題')
  if (homework) {
    const next = all.find((h) => h.index > homework.index && h.level <= homework.level)
    const end = next?.index ?? lines.length
    let last = end - 1
    while (last > homework.index && blank(lines[last])) last--
    if (last === homework.index) {
      // 見出しだけで中身がない
      const insert = next && end === homework.index + 1 ? [cr, entry, cr] : [cr, entry]
      lines.splice(homework.index + 1, 0, ...insert)
    } else if (LIST_ITEM.test(plain(lines[last])) || /^[ \t]/.test(plain(lines[last]))) {
      lines.splice(last + 1, 0, entry)
    } else {
      // 最後が段落なら、空行をはさんでリストにする
      lines.splice(last + 1, 0, cr, entry)
    }
    return replaceBody(text, lines.join('\n'))
  }

  const section = [`## 宿題${cr}`, cr, entry, cr]
  const transcript = all.find((h) => h.text === '文字起こし')
  if (transcript) {
    const before = transcript.index > 0 && !blank(lines[transcript.index - 1]) ? [cr] : []
    lines.splice(transcript.index, 0, ...before, ...section)
    return replaceBody(text, lines.join('\n'))
  }

  let end = lines.length
  while (end > 0 && blank(lines[end - 1])) end--
  const head = lines.slice(0, end)
  const newBody = [...head, ...(end > 0 ? [cr] : []), ...section.slice(0, 3), ''].join('\n')
  return replaceBody(text, newBody)
}
