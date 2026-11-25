// ノート（tasks/notes/ の1ファイル）の読み取り・一覧・宿題への書き戻しなど、ファイルや画面に依存しない処理
// 裏方（main）と画面（renderer）の両方から使う

import { parse } from 'yaml'
import { replaceBody } from './frontmatter'
import { validDate } from './schedule'
import { matchesTags } from './tagKey'
import {
  asString,
  asTags,
  compareTickets,
  idFromFileName,
  splitFrontmatter,
  titleFromBody,
  type Ticket
} from './ticket'

/** ノートを置くフォルダの名前（tasks/ の中） */
export const NOTES_DIR = 'notes'
/** ノートのキー（Note.fileName）の頭 */
export const NOTES_PREFIX = `${NOTES_DIR}/`
/** プロジェクトをまたぐ知識を置くフォルダ（notes/ の直下）。ここのノートから起こしたチケットには、フォルダ名のタグを付けない */
export const COMMON_FOLDER = '共通'

/**
 * ノートの種類（frontmatter の `type`）
 * - record：記録（議事メモ・作業の記録など。その時に起きたこと。書き換えない）
 * - knowledge：知識（手順・仕様・今の決まりなど。今の正しい状態。変わったら書き換える）
 * - index：入口（プロジェクトの目的・知識の状況・ノートの一覧。進み具合はチケットに持たせる）
 */
export const NOTE_TYPES = ['record', 'knowledge', 'index'] as const
export type NoteType = (typeof NOTE_TYPES)[number]

export interface Note {
  /**
   * ノートを表すキー。`notes/ファイル名`、フォルダの中なら `notes/フォルダ/ファイル名`
   * （画面と裏方の間で、どのファイルかを指すのに使う。区切りはいつも `/`）
   */
  fileName: string
  /** notes/ の中のフォルダ（`案件A/定例` など）。notes/ の直下なら空文字 */
  folder: string
  /** ファイル名の先頭から読んだID。IDで始まらない名前なら null */
  fileId: string | null
  /** frontmatter の id */
  id: string | null
  title: string
  /** 種類。`type` がない・知らない値なら記録（record）として扱う */
  type: NoteType
  /** ノートの日付（会議の日、書いた日など） */
  date: string | null
  /** 最後に見直した日（知識のノートで使う） */
  reviewed: string | null
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

/** ノートのキーを、notes/ の中のフォルダとファイル名に分ける */
export function splitNoteKey(key: string): { folder: string; name: string } {
  const rest = isNoteKey(key) ? key.slice(NOTES_PREFIX.length) : key
  const at = rest.lastIndexOf('/')
  return at < 0
    ? { folder: '', name: rest }
    : { folder: rest.slice(0, at), name: rest.slice(at + 1) }
}

/** フォルダとファイル名から、ノートのキーを作る */
export function noteKey(folder: string, name: string): string {
  return NOTES_PREFIX + (folder ? `${folder}/` : '') + name
}

/** フォルダの名前の長さの上限 */
const MAX_FOLDER_NAME_LENGTH = 100

/**
 * フォルダの名前（1段分）として使えるか。使えなければ理由を返す
 * Windows で使えない文字・制御文字・`.` で始まる名前（隠しフォルダとして無視するため）・最後の空白とピリオドは使えない
 */
export function folderNameError(name: string): string | null {
  if (name.trim() === '') return 'フォルダの名前を入れてください'
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)) {
    return 'フォルダの名前に \\ / : * ? " < > | と改行などは使えません'
  }
  if (name.startsWith('.')) return 'フォルダの名前を「.」で始めることはできません'
  if (/[ .]$/.test(name) || name !== name.trim()) {
    return 'フォルダの名前の前後に空白、最後にピリオドは使えません'
  }
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return `フォルダの名前は${MAX_FOLDER_NAME_LENGTH}文字までにしてください`
  }
  return null
}

/**
 * notes/ の中のフォルダ（`案件A/定例` など。空文字は notes/ の直下）として読んでよい形か
 * notes/ の外を指さない（`..` や区切り文字を含まない）・隠しフォルダ（`.` で始まる）でないことだけを確かめる
 * （エクスプローラーや AI が作ったフォルダも読むので、作るときの決まり `folderNameError` より緩い）
 */
export function isSafeNoteFolder(folder: string): boolean {
  return (
    folder === '' ||
    folder
      .split('/')
      // eslint-disable-next-line no-control-regex
      .every((part) => part !== '' && !part.startsWith('.') && !/[\\:\u0000-\u001f]/.test(part))
  )
}

/** そのフォルダか、その下のフォルダか（folder が空文字なら、すべて） */
export function isInFolder(noteFolder: string, folder: string): boolean {
  return folder === '' || noteFolder === folder || noteFolder.startsWith(`${folder}/`)
}

/** ノートから起こしたチケットに付ける、プロジェクトのタグ（notes/ の直下のフォルダ名）。共通/ と直下のノートは null */
export function projectTag(folder: string): string | null {
  const top = folder.split('/')[0]
  return top === '' || top === COMMON_FOLDER ? null : top
}

/**
 * ノートの種類を変えるときに書き換える項目
 * - 知識にしたとき、見直した日がなければ今日を入れる（書いた時点で見直したとみなす）
 * - 知識から別の種類にしたとき、見直した日を空にする（`reviewed` は知識のノートにだけ書く。行は残す）
 */
export function noteTypeChange(
  type: NoteType,
  reviewed: string | null,
  today: string
): { type: NoteType; reviewed?: string | null } {
  if (type === 'knowledge') return reviewed ? { type } : { type, reviewed: today }
  return reviewed ? { type, reviewed: null } : { type }
}

function asNoteType(value: unknown): NoteType {
  return NOTE_TYPES.find((t) => t === value) ?? 'record'
}

/**
 * キーと中身からノートを読み取る。書き換えは一切しない
 * @param key `notes/ファイル名`・`notes/フォルダ/ファイル名`（ファイル名だけでもよい）
 */
export function parseNote(key: string, text: string): Note {
  const { folder, name } = splitNoteKey(key)
  const note: Note = {
    fileName: noteKey(folder, name),
    folder,
    fileId: idFromFileName(name),
    id: null,
    title: '',
    type: 'record',
    date: null,
    reviewed: null,
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
  note.type = asNoteType(fm.type)
  note.date = asString(fm.date)
  note.reviewed = asString(fm.reviewed)
  note.tags = asTags(fm.tags)
  note.author = asString(fm.author)
  note.created = asString(fm.created)
  return note
}

/** 一覧の並べ替えに使う日付。`date` がなければ `created` */
export function noteDate(note: Note): string | null {
  return validDate(note.date) ?? validDate(note.created)
}

/** ノートの一覧の絞り込み（タグはほかの画面と共通） */
export interface NoteFilter {
  /** タグ。空なら絞り込まない */
  tags: string[]
  /** フォルダ（その下のフォルダも含む）。空文字ならすべて */
  folder: string
  /** 種類。空なら絞り込まない */
  types: NoteType[]
}

/**
 * ノートの一覧に出すノートを返す。日付の新しい順（日付のないものは最後）、同じ日は ID の新しい順
 */
export function listNotes(notes: Note[], filter: Partial<NoteFilter> = {}): Note[] {
  const { tags = [], folder = '', types = [] } = filter
  return notes
    .filter((n) => matchesTags(n.tags, tags))
    .filter((n) => isInFolder(n.folder, folder))
    .filter((n) => types.length === 0 || types.includes(n.type))
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

/**
 * 入口のノートのプロジェクトのタグ。プロジェクトのフォルダ（notes/ の直下のフォルダ。共通/ を除く）の
 * 直下にある `type: index` のノートだけ。それ以外は null
 */
export function indexProjectTag(note: Pick<Note, 'type' | 'folder'>): string | null {
  if (note.type !== 'index' || note.folder.includes('/')) return null
  return projectTag(note.folder)
}

/**
 * 入口のノートに出す、そのプロジェクトの未完了のチケット（プロジェクトのタグが付いたもの）
 * 期限の近い順（期限のないものは最後）。アーカイブしたものと完了したものは除く
 * プロジェクトの進み具合は入口のノートに書かず、チケットだけに持たせるため、入口からたどれるようにする
 */
export function projectOpenTickets(
  note: Pick<Note, 'type' | 'folder'>,
  tickets: Ticket[]
): Ticket[] {
  const tag = indexProjectTag(note)
  if (tag === null) return []
  return tickets
    .filter((t) => !t.archived && t.status !== 'done' && t.tags.includes(tag))
    .sort(compareTickets)
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

/**
 * 本文に「宿題」の見出しがあるか（コードブロックの中は除く）
 * ノートから起こしたチケットへのリンクを書き戻すのは、「宿題」の見出しがあるノートだけ
 * （知識のノートなどに、チケットへのリンクが書き足されないように）
 */
export function hasHomeworkHeading(text: string): boolean {
  const body = splitFrontmatter(text)?.body ?? text
  return headings(body.split('\n').map((l) => l.replace(/\r$/, ''))).some((h) => h.text === '宿題')
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
 * 「宿題」の項目の文から、チケットのタイトルと担当者を取り出す（skill mokkan-creating-tasks-from-notes の手順と同じく担当者を拾う）
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
 * ノートの「宿題」の最後に、箇条書きの1行（`- item`）を足す（skill mokkan-creating-tasks-from-notes の手順と同じ）
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
