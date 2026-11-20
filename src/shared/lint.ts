// ノートの点検（切れたリンク・見直していない知識など）と被リンク
// 裏方が呼ばれたときにファイルを読み、ここで判定する。結果は持ち続けず、ファイルにも書かない（ファイルだけがデータ）
// アプリは見つけて知らせるだけで、中身を自分から書き換えない。例外は、人が「直す」を押したずれたリンク（replaceLinkDestination）

import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { ARCHIVE_PREFIX } from './archive'
import {
  findIds,
  idFromHref,
  markdownLinkDestination,
  relativeLinkPath,
  resolveLinkPath,
  tasksPathOf
} from './links'
import { COMMON_FOLDER, isNoteKey, type Note } from './note'
import { validDate } from './schedule'
import { splitFrontmatter, type Ticket } from './ticket'

/** 見直していない知識とみなす日数 */
export const REVIEW_AFTER_DAYS = 180
/** 長すぎるとみなす本文の文字数（空白と改行を除く。RULES.md の「1〜2画面」の目安） */
export const MAX_KNOWLEDGE_LENGTH = 3000
/** 確かめていない記述の印（RULES.md「知識のノート」） */
const UNVERIFIED_MARKS = ['（要確認', '（未確認']

export type LintKind =
  'broken-link' | 'shifted-link' | 'no-index' | 'orphan' | 'unreviewed' | 'unverified' | 'too-long'

/** 種類の並び順（壊れているものを上に） */
export const LINT_KINDS: readonly LintKind[] = [
  'broken-link',
  'shifted-link',
  'no-index',
  'orphan',
  'unreviewed',
  'unverified',
  'too-long'
]

export const LINT_KIND_LABELS: Record<LintKind, string> = {
  'broken-link': '切れたリンク',
  'shifted-link': 'ずれたリンク',
  'no-index': '入口がない',
  orphan: '入口から外れた知識',
  unreviewed: '見直していない知識',
  unverified: '確かめていない記述',
  'too-long': '長すぎる知識'
}

export const LINT_KIND_HINTS: Record<LintKind, string> = {
  'broken-link': 'リンク先の ID のチケット・ノートがありません',
  'shifted-link':
    'リンク先はありますが、相対パスが今のファイルを指していません。アプリでは開けますが、ほかのエディタではたどれません',
  'no-index': 'プロジェクトのフォルダに、入口のノート（種類：入口）がありません',
  orphan:
    'プロジェクトの知識は入口のノートから、共通/ と notes/ の直下の知識はどのファイルからも、リンクされていません',
  unreviewed: `見直した日がないか、${REVIEW_AFTER_DAYS}日より前です`,
  unverified: '（要確認）や（未確認）が残っています',
  'too-long': `本文が ${MAX_KNOWLEDGE_LENGTH} 文字（空白と改行を除く）より長いので、テーマごとに分けることを考えてください`
}

export interface LintItem {
  kind: LintKind
  /** 対象のファイルのキー。入口がない（フォルダが対象）ときは null */
  fileName: string | null
  /** 対象のファイルのタイトル。入口がないときはフォルダ（`notes/` からの名前） */
  title: string
  /** 何が見つかったか（1行） */
  detail: string
  /** 見つかった行（ファイルの先頭から1で数える） */
  line: number | null
  /** ずれたリンクのとき、そのリンク先（ファイルに書いてあるもの）。「直す」に渡す */
  href: string | null
}

/** 点検と被リンクに渡すファイル（一覧のチケット・ノートと、裏方が読んだ中身） */
export interface LintEntry {
  file: Ticket | Note
  text: string
}

// ---- 本文の中のリンクと ID ----

/** 本文の中の、他のチケット・ノートへのリンクか ID */
export interface BodyRef {
  /** リンク先の ID */
  id: string
  /** md のリンクのリンク先。文字で書いた ID なら null */
  href: string | null
  /** ファイルの先頭から1で数えた行 */
  line: number
}

interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } }
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** ファイルの中身を、本文と、本文が始まる位置・行に分ける */
function bodyPart(text: string): { body: string; offset: number; line: number } {
  const body = splitFrontmatter(text)?.body ?? text
  const offset = text.length - body.length
  const line = text.slice(0, offset).split('\n').length
  return { body, offset, line }
}

/** 中を見ないもの（コードとして書いたもの・HTML・画像） */
const SKIP_TYPES = new Set(['code', 'inlineCode', 'html', 'image', 'imageReference'])

/** ファイルの本文の中の、他のチケット・ノートへの md のリンクと、文字で書いた ID（コードの中は除く） */
export function bodyRefs(text: string): BodyRef[] {
  const { body, line: firstLine } = bodyPart(text)
  const refs: BodyRef[] = []
  const lineOf = (node: MdNode): number => firstLine + (node.position?.start.line ?? 1) - 1
  const walk = (node: MdNode): void => {
    if (SKIP_TYPES.has(node.type)) return
    if (node.type === 'link' || node.type === 'definition') {
      const id = idFromHref(node.url ?? '')
      if (id) refs.push({ id, href: node.url ?? '', line: lineOf(node) })
      // リンクの文字（`→ [ID](…)` の ID など）は、リンク先と同じものを指すので数えない
      return
    }
    if (node.type === 'linkReference') return
    if (node.type === 'text' && node.value) {
      for (const m of findIds(node.value)) {
        const before = node.value.slice(0, m.start).split('\n').length - 1
        refs.push({ id: m.id, href: null, line: lineOf(node) + before })
      }
      return
    }
    node.children?.forEach(walk)
  }
  walk(parser.parse(body) as MdNode)
  return refs
}

// ---- 点検 ----

function idsOf(file: Ticket | Note): string[] {
  return [...new Set([file.id, file.fileId].filter((id): id is string => id !== null))]
}

function isArchived(file: Ticket | Note): boolean {
  return file.fileName.startsWith(ARCHIVE_PREFIX)
}

/** 2つの `YYYY-MM-DD` の間の日数（to − from） */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** ノートのプロジェクト（notes/ の直下のフォルダ名）。共通/ と notes/ の直下は null */
function projectOf(note: Note): string | null {
  const top = note.folder.split('/')[0]
  return top === '' || top === COMMON_FOLDER ? null : top
}

/**
 * チケットとノートを点検する
 * - 切れたリンク・ずれたリンク：tickets/ とノートの本文（archive/ は片付けたものなので見ない）
 * - そのほか：知識のノートと、プロジェクトのフォルダ
 * @param today 今日（`YYYY-MM-DD`）
 * @returns 見つかったもの（LINT_KINDS の順、同じ種類はキーの順）
 */
export function lintFiles(entries: readonly LintEntry[], today: string): LintItem[] {
  const keyById = new Map<string, string>()
  for (const { file } of entries) {
    for (const id of idsOf(file)) if (!keyById.has(id)) keyById.set(id, file.fileName)
  }
  const refsByKey = new Map(entries.map((e) => [e.file.fileName, bodyRefs(e.text)] as const))
  const items: LintItem[] = []
  const titleOf = (file: Ticket | Note): string => file.title || '（タイトルなし）'

  // リンク
  for (const { file } of entries) {
    if (isArchived(file)) continue
    const broken = new Set<string>()
    const shifted = new Set<string>()
    for (const ref of refsByKey.get(file.fileName) ?? []) {
      const target = keyById.get(ref.id)
      if (target === undefined) {
        if (broken.has(ref.id)) continue
        broken.add(ref.id)
        items.push({
          kind: 'broken-link',
          fileName: file.fileName,
          title: titleOf(file),
          detail: ref.href
            ? `リンク先 ${ref.href} の ${ref.id} が見つかりません`
            : `${ref.id} が見つかりません`,
          line: ref.line,
          href: ref.href
        })
        continue
      }
      if (ref.href === null || shifted.has(ref.href)) continue
      if (resolveLinkPath(file.fileName, ref.href) === tasksPathOf(target)) continue
      shifted.add(ref.href)
      items.push({
        kind: 'shifted-link',
        fileName: file.fileName,
        title: titleOf(file),
        detail: `${ref.href} → ${relativeLinkPath(file.fileName, target)}`,
        line: ref.line,
        href: ref.href
      })
    }
  }

  const notes = entries.filter((e) => isNoteKey(e.file.fileName)) as { file: Note; text: string }[]

  // 入口がない（ノートがあるプロジェクトのフォルダだけ）
  const projects = new Set(notes.map((n) => projectOf(n.file)).filter((p) => p !== null))
  const indexesByProject = new Map<string, Note[]>()
  for (const { file } of notes) {
    const project = projectOf(file)
    if (file.type !== 'index' || project === null) continue
    indexesByProject.set(project, [...(indexesByProject.get(project) ?? []), file])
  }
  for (const project of [...projects].sort()) {
    if (indexesByProject.has(project)) continue
    items.push({
      kind: 'no-index',
      fileName: null,
      title: project,
      detail: '種類が「入口」のノートがありません',
      line: null,
      href: null
    })
  }

  // 知識のノート
  const linksTo = (fromKey: string, ids: string[]): boolean =>
    (refsByKey.get(fromKey) ?? []).some((r) => ids.includes(r.id))
  for (const { file, text } of notes) {
    if (file.type !== 'knowledge') continue
    const ids = idsOf(file)
    const title = titleOf(file)
    const base = { fileName: file.fileName, title, href: null }

    const project = projectOf(file)
    if (project === null) {
      const linked = entries.some(
        (e) => e.file.fileName !== file.fileName && linksTo(e.file.fileName, ids)
      )
      if (!linked) {
        items.push({
          ...base,
          kind: 'orphan',
          detail: 'どこからもリンクされていません',
          line: null
        })
      }
    } else {
      const indexes = indexesByProject.get(project) ?? []
      if (indexes.length > 0 && !indexes.some((i) => linksTo(i.fileName, ids))) {
        items.push({
          ...base,
          kind: 'orphan',
          detail: `入口のノート（${indexes.map(titleOf).join('・')}）からリンクされていません`,
          line: null
        })
      }
    }

    const reviewed = validDate(file.reviewed)
    if (reviewed === null) {
      items.push({ ...base, kind: 'unreviewed', detail: '見直した日がありません', line: null })
    } else {
      const days = daysBetween(reviewed, today)
      if (days > REVIEW_AFTER_DAYS) {
        items.push({
          ...base,
          kind: 'unreviewed',
          detail: `最後に見直した日 ${reviewed}（${days}日前）`,
          line: null
        })
      }
    }

    const { body, line: firstLine } = bodyPart(text)
    const lines = body.split('\n')
    const marked = lines.flatMap((l, i) => (UNVERIFIED_MARKS.some((m) => l.includes(m)) ? [i] : []))
    if (marked.length > 0) {
      items.push({
        ...base,
        kind: 'unverified',
        detail: `${marked.length} か所（最初：${lines[marked[0]].trim().slice(0, 60)}）`,
        line: firstLine + marked[0]
      })
    }

    const length = [...body.replace(/\s/g, '')].length
    if (length > MAX_KNOWLEDGE_LENGTH) {
      items.push({ ...base, kind: 'too-long', detail: `本文 ${length} 文字`, line: null })
    }
  }

  const order = (i: LintItem): number => LINT_KINDS.indexOf(i.kind)
  return items.sort(
    (a, b) =>
      order(a) - order(b) ||
      (a.fileName ?? a.title).localeCompare(b.fileName ?? b.title) ||
      (a.line ?? 0) - (b.line ?? 0)
  )
}

// ---- 被リンク ----

export interface Backlink {
  fileName: string
  title: string
}

/**
 * そのファイルへのリンク（本文の md のリンクと、文字で書いた ID）があるファイル。自分は除く
 * チケットの parent・source はプロパティに出ているので含めない
 * @returns キーの順
 */
export function backlinksOf(key: string, entries: readonly LintEntry[]): Backlink[] {
  const target = entries.find((e) => e.file.fileName === key)
  if (!target) return []
  const ids = idsOf(target.file)
  if (ids.length === 0) return []
  return entries
    .filter((e) => e.file.fileName !== key && bodyRefs(e.text).some((r) => ids.includes(r.id)))
    .map((e) => ({ fileName: e.file.fileName, title: e.file.title }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
}

// ---- ずれたリンクを直す ----

/**
 * md のリンク（`[文字](リンク先 "題")`）の書き方の中で、リンク先が書いてある範囲
 * 参照の形（`[文字][名前]`）など、その場にリンク先がないものは null
 */
function destinationRange(source: string): { start: number; end: number } | null {
  if (!source.startsWith('[') || !source.endsWith(')')) return null
  let i = 1
  let depth = 1
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      const run = /^`+/.exec(source.slice(i))![0]
      const close = source.indexOf(run, i + run.length)
      i = close < 0 ? i + run.length : close + run.length
      continue
    }
    if (c === '[') depth++
    if (c === ']' && --depth === 0) break
    i++
  }
  if (depth !== 0 || source[i + 1] !== '(') return null
  i += 2
  while (i < source.length && /[ \t\r\n]/.test(source[i])) i++
  const start = i
  if (source[i] === '<') {
    let j = i + 1
    while (j < source.length && source[j] !== '>' && source[j] !== '\n')
      j += source[j] === '\\' ? 2 : 1
    return source[j] === '>' ? { start, end: j + 1 } : null
  }
  let j = i
  let parens = 0
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (/\s/.test(c)) break
    if (c === '(') parens++
    if (c === ')') {
      if (parens === 0) break
      parens--
    }
    j++
  }
  return j > start ? { start, end: j } : null
}

/** ファイルに書いてあるリンク先を、md として読んだ値に戻す（`<…>` を外し、`\` のエスケープを戻す） */
function destinationValue(raw: string): string {
  const inner = raw.startsWith('<') ? raw.slice(1, -1) : raw
  return inner.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

/**
 * 本文の md のリンクのうち、リンク先が href のものを to に書き換える。ほかの文字は1文字も変えない
 * （同じリンク先のリンクが2つ以上あれば、どれも同じずれなのですべて直す）
 * `?`・`#` から後ろは残す。参照の形のリンク（`[文字][名前]`）は書き換えない
 * @returns 書き換えた中身。書き換えるリンクがなければ null
 */
export function replaceLinkDestination(text: string, href: string, to: string): string | null {
  const { body, offset } = bodyPart(text)
  const ranges: { start: number; end: number }[] = []
  const walk = (node: MdNode): void => {
    if (SKIP_TYPES.has(node.type)) return
    if (node.type === 'link' && node.url === href) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const range = destinationRange(body.slice(start, end))
      if (range && destinationValue(body.slice(start + range.start, start + range.end)) === href) {
        ranges.push({ start: offset + start + range.start, end: offset + start + range.end })
      }
      return
    }
    node.children?.forEach(walk)
  }
  walk(parser.parse(body) as MdNode)
  if (ranges.length === 0) return null
  const suffix = /[?#].*$/.exec(href)?.[0] ?? ''
  const destination = markdownLinkDestination(to + suffix)
  let result = text
  for (const r of ranges.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, r.start) + destination + result.slice(r.end)
  }
  return result
}

// ---- md でコピー ----

/** 点検の結果の md の頭に入れる、AI に頼む文 */
export const LINT_REQUEST =
  'この点検の結果をもとに、直す案を出してください。直すのは、人が確かめてからにしてください。'

/**
 * 点検の結果を md の箇条書きにする（クリップボードに入れて AI に渡すため。ファイルには書かない）
 * リンクは tasks/ からの相対パスにする（tasks/ で動く AI がそのまま開けるように）
 */
export function lintToMarkdown(items: readonly LintItem[], today: string): string {
  const lines = [`# ノートの点検（${today}）`, '']
  if (items.length === 0) lines.push('見つかったものはありません。', '')
  // AI に貼るだけで頼めるように、頼む文を頭に入れる（クリップボードは1つなので、頼む文と結果を別々にコピーさせない）
  else lines.push(LINT_REQUEST, '')
  for (const kind of LINT_KINDS) {
    const group = items.filter((i) => i.kind === kind)
    if (group.length === 0) continue
    lines.push(`## ${LINT_KIND_LABELS[kind]}`, '', LINT_KIND_HINTS[kind], '')
    for (const item of group) {
      const at = item.line !== null ? `（${item.line}行目）` : ''
      const target =
        item.fileName === null
          ? `\`notes/${item.title}/\``
          : `[${item.title.replace(/[[\]]/g, '\\$&')}](${markdownLinkDestination(tasksPathOf(item.fileName))})`
      lines.push(`- ${target}${at}：${item.detail}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
