// tasks/ フォルダの読み込み・監視・チケット作成・アーカイブ・削除。ファイルに触るのはここだけ
// ファイルだけがデータなので、ここで持つ一覧はいつでもファイルから作り直せるキャッシュにすぎない

import { watch, type FSWatcher } from 'chokidar'
import { randomInt } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  AppState,
  FolderStatus,
  FromNoteResult,
  RepeatResult,
  RuleFileStatus,
  SaveResult
} from '../shared/api'
import {
  ARCHIVE_DIR,
  ARCHIVE_PREFIX,
  archivePlan,
  bulkArchiveTargets,
  deleteTargets,
  restoreTargets
} from '../shared/archive'
import {
  NOTE_FIELD_ORDER,
  assigneeField,
  setFields,
  type FieldUpdates
} from '../shared/frontmatter'
import { markdownLinkDestination, relativeLinkPath } from '../shared/links'
import {
  NOTES_DIR,
  NOTES_PREFIX,
  appendHomework,
  attachHomework,
  isNoteKey,
  parseNote,
  type Note
} from '../shared/note'
import { buildNextTicket, findExistingNext, nextSchedule, withTitle } from '../shared/repeat'
import {
  compareHits,
  searchFile,
  splitTerms,
  type SearchHit,
  type SearchOptions
} from '../shared/search'
import {
  TAGS_FILE,
  isTagsConflictFileName,
  parseTagColors,
  setTagColorText,
  type TagColors
} from '../shared/tagColor'
import { validDate } from '../shared/schedule'
import {
  fillTemplate,
  formatDate,
  generateId,
  isBlankBody,
  isTicketFileName,
  parseTicket,
  splitFrontmatter,
  titledFileName,
  type Ticket
} from '../shared/ticket'
import bundledRules from '../../templates/RULES.md?raw'
import bundledTemplate from '../../templates/TEMPLATE.md?raw'
import bundledNoteTemplate from '../../templates/NOTE_TEMPLATE.md?raw'
import bundledAiGuide from '../../templates/AI_GUIDE.md?raw'

/** 監視で拾った変更をまとめて画面に送るまでの待ち時間 */
const EMIT_DELAY_MS = 50
/** 検索で返す件数の上限 */
const MAX_SEARCH_HITS = 50
/** ID が重なったときに作り直す回数の上限 */
const MAX_CREATE_ATTEMPTS = 10

/**
 * アプリで新しいチケットを作るときの初めの値。着手日は今日、担当者と作成者は自分
 * 期限は入れない（今日を入れると、変え忘れたときに翌日「期限切れ」になるため）
 */
function newTicketDefaults(author: string, today: string): FieldUpdates {
  return { start: today, ...(author ? { assignee: author, author } : {}) }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

/**
 * tasks/ 直下に置くルールのファイルと、その原本
 * CLAUDE.md（Claude Code が読む）と AGENTS.md（ほかの多くの AI ツールが読む）は、同じ原本（AI_GUIDE.md）から作る
 */
export const RULE_FILES: ReadonlyArray<{ name: string; content: string }> = [
  { name: 'RULES.md', content: bundledRules },
  { name: 'TEMPLATE.md', content: bundledTemplate },
  { name: 'NOTE_TEMPLATE.md', content: bundledNoteTemplate },
  { name: 'CLAUDE.md', content: bundledAiGuide },
  { name: 'AGENTS.md', content: bundledAiGuide }
]

/** ノートからチケットを起こすときの、タイトルのほかの値 */
export interface FromNoteOptions {
  /** 「宿題」の項目の文（その行の最後に「→ リンク」を付ける） */
  homeworkItem?: string | null
  /** 担当者。空なら自分 */
  assignee?: string[]
  /** 期限（YYYY-MM-DD） */
  due?: string | null
}

export interface TaskStoreOptions {
  /** ファイルを OS のごみ箱に移す（削除はこれでだけ行い、完全には消さない） */
  trash?: (path: string) => Promise<void>
}

export class TaskStore {
  private readonly root: string | null
  private readonly ticketsDir: string | null
  private readonly archiveDir: string | null
  private readonly notesDir: string | null
  private readonly tickets = new Map<string, Ticket>()
  private readonly notes = new Map<string, Note>()
  private watcher: FSWatcher | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private folderStatus: FolderStatus = 'unset'
  /** このアプリが作ったチケットと、作ったときの中身（空のまま閉じたら削除するため） */
  private readonly createdBySelf = new Map<string, string>()
  /** 繰り返しの次回分を作る処理を、1件ずつ順に行うための待ち行列 */
  private repeatQueue: Promise<unknown> = Promise.resolve()
  /** tasks/TAGS.md のタグの色と、読めなかった理由、同期サービスの競合コピー */
  private tagColors: TagColors = {}
  private tagFileError: string | null = null
  private readonly tagConflicts = new Set<string>()
  /** タグの色の書き込みを、1件ずつ順に行うための待ち行列 */
  private tagQueue: Promise<unknown> = Promise.resolve()
  /** 起動時に見出しを付け足したファイルの数（画面で案内する） */
  private renamedOnStart = 0

  constructor(
    private readonly tasksDir: string | null,
    private readonly onChange: (state: AppState) => void,
    private readonly options: TaskStoreOptions = {}
  ) {
    this.root = tasksDir ? resolve(tasksDir) : null
    this.ticketsDir = tasksDir ? resolve(tasksDir, 'tickets') : null
    this.archiveDir = tasksDir ? resolve(tasksDir, ARCHIVE_DIR) : null
    this.notesDir = tasksDir ? resolve(tasksDir, NOTES_DIR) : null
  }

  getState(): AppState {
    const tickets = [...this.tickets.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
    const notes = [...this.notes.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
    return {
      tasksDir: this.tasksDir,
      folderStatus: this.folderStatus,
      tickets,
      notes,
      tagColors: { ...this.tagColors },
      tagFile: { error: this.tagFileError, conflicts: [...this.tagConflicts].sort() },
      renamedOnStart: this.renamedOnStart
    }
  }

  /** フォルダの状態を調べ、使える状態なら全件読み込んで監視を始める */
  async start(): Promise<void> {
    this.folderStatus = this.checkFolder()
    if (this.folderStatus !== 'ready' || !this.ticketsDir) return

    // 監視の準備ができてから全件を読む。逆の順だと、その間に起きた変更を取りこぼす
    // tickets/・archive/・notes/ を監視する（archive/ と notes/ は後から作られることがあるので、tasks/ から1段下まで見る）
    const root = this.root!
    const dirs = new Set([root, this.ticketsDir, this.archiveDir, this.notesDir])
    this.watcher = watch(root, {
      ignoreInitial: true,
      depth: 1,
      // 同期サービスやエディタが書き込み途中のファイルを読まないよう、落ち着くまで待つ
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      // chokidar は Windows でも `C:/...` の形でパスを渡すので、正規化してから比べる
      ignored: (path) =>
        !dirs.has(resolve(path)) && this.keyOf(path) === null && !this.isTagsPath(path)
    })
    this.watcher
      .on('add', (path) => void this.loadAny(path).then(() => this.scheduleEmit()))
      .on('change', (path) => void this.loadAny(path).then(() => this.scheduleEmit()))
      .on('unlink', (path) => {
        const key = this.keyOf(path)
        if (key) this.forget(key)
        const done = this.isTagsPath(path) ? this.loadTags() : Promise.resolve()
        void done.then(() => this.scheduleEmit())
      })
      .on('error', (error) => console.error('[mokkan] ファイル監視のエラー', error))
    await new Promise<void>((done) => this.watcher?.once('ready', () => done()))

    for (const dir of [this.ticketsDir, this.archiveDir, this.notesDir]) {
      if (!dir || !existsSync(dir)) continue
      const entries = await readdir(dir, { withFileTypes: true })
      await Promise.all(
        entries
          .filter((e) => e.isFile() && isTicketFileName(e.name))
          .map((e) => this.load(join(dir, e.name)))
      )
    }
    await this.loadTags()
  }

  /**
   * チケット・ノート・アーカイブを、タイトルと本文から探す
   * 本文は持ち続けず、探すたびにファイルを読む（ファイルだけがデータ）
   * @returns 当たったもの（タイトルに当たったもの→最近更新したものの順、最大 MAX_SEARCH_HITS 件）
   */
  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const terms = splitTerms(query)
    if (terms.length === 0) return []
    const entries = [...this.tickets.values(), ...this.notes.values()]
    const hits = await Promise.all(
      entries.map(async (e) => {
        try {
          const text = await readFile(this.ticketPath(e.fileName), 'utf8')
          return searchFile(e, text, terms, options)
        } catch {
          // 同期中で読めない・消えたなど。次に探すときにまた読む
          return null
        }
      })
    )
    return hits
      .filter((h): h is SearchHit => h !== null)
      .sort(compareHits)
      .slice(0, MAX_SEARCH_HITS)
  }

  /**
   * 起動して読み込んだ後に1回だけ、ファイル名が ID だけ（`ID.md`）のチケットとノートに見出しを付け足す
   * 同期サービスで名前の変更が重なると競合のもとになるので、次のものだけに限る
   * - tickets/ と notes/ の `ID.md`（archive/ は移したときの名前のまま。すでにタイトルがある名前や手で付けた名前は変えない）
   * - 見出しがあり、frontmatter が読めて id がファイル名と同じもの
   * - 作成者（author）が自分か空のもの（他の人が作ったファイルには触れない）
   * - 変える先に同じ名前のファイルがないもの
   * @param userName 自分の名前（設定）
   * @returns 名前を変えた件数
   */
  async renameUntitledFiles(userName: string): Promise<number> {
    if (this.folderStatus !== 'ready') return 0
    const me = userName.trim()
    const targets = [...this.tickets.values(), ...this.notes.values()].filter(
      (f) =>
        !('archived' in f && f.archived) &&
        f.fileId !== null &&
        basename(f.fileName) === `${f.fileId}.md` &&
        f.parseError === null &&
        f.id === f.fileId &&
        (f.author === null || f.author === me)
    )
    let count = 0
    for (const f of targets) {
      const name = titledFileName(f.fileId!, f.title)
      if (!name) continue
      const from = this.ticketPath(f.fileName)
      const to = join(dirname(from), name)
      try {
        // rename は Windows では同じ名前のファイルを上書きするので、直前に確かめてから変える。
        // コピーして消す方法は同期サービスで別のファイルになり版の履歴が切れるので使わない（moveTickets と同じ）
        if (existsSync(to)) continue
        await rename(from, to)
        this.forget(f.fileName)
        this.createdBySelf.delete(f.fileName)
        await this.load(to)
        count++
      } catch (error) {
        // 同期中でロックされているなど。次の起動でもう一度試す
        console.error(`[mokkan] ${f.fileName} の名前を変えられませんでした`, error)
      }
    }
    this.renamedOnStart = count
    if (count > 0) this.scheduleEmit()
    return count
  }

  /**
   * タグの色を tasks/TAGS.md に書く。変えたタグの行だけを書き換える（ファイルがなければ作る）
   * 色を選んだその場で読んで書くので、画面が前に読んだ内容とは比べない（外部の変更はその時点の内容に足す）
   * 続けて呼ばれても前の書き込みを消さないよう、1件ずつ順に行う
   *
   * 限界：読んでから書くまでのわずかな間に同期サービスなどで TAGS.md が変わると、その変更を上書きする。
   * TAGS.md は同期フォルダで共有するので競合しやすいが、変えるのは1行だけで、読んでからすぐ書くことで間隔を短くしている
   * @param hue 色相（0〜359）。null なら指定を外す
   */
  setTagColor(tag: string, hue: number | null): Promise<void> {
    const run = this.tagQueue.then(() => this.setTagColorNow(tag, hue))
    this.tagQueue = run.catch(() => undefined)
    return run
  }

  private async setTagColorNow(tag: string, hue: number | null): Promise<void> {
    if (this.folderStatus !== 'ready' || !this.root) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    const path = join(this.root, TAGS_FILE)
    let current: string | null = null
    try {
      current = await readFile(path, 'utf8')
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
    }
    const next = setTagColorText(current, tag, hue)
    if (next === current) return
    // ないときは、同じ名前のファイルがないときだけ作る（同期で現れたファイルを上書きしない）
    await writeFile(path, next, current === null ? { flag: 'wx' } : {})
    await this.loadTags()
    this.scheduleEmit()
  }

  /** tasks/ 直下の TAGS.md か、その競合コピーか */
  private isTagsPath(path: string): boolean {
    const full = resolve(path)
    if (!this.root || dirname(full) !== this.root) return false
    const name = basename(full)
    return name === TAGS_FILE || isTagsConflictFileName(name)
  }

  /** tickets/・archive/・notes/ のファイルか TAGS.md を読み直す */
  private async loadAny(path: string): Promise<void> {
    if (this.isTagsPath(path)) await this.loadTags()
    else await this.load(path)
  }

  /** TAGS.md のタグの色と、競合コピーを読み直す */
  private async loadTags(): Promise<void> {
    if (!this.root) return
    try {
      const { colors, error } = parseTagColors(await readFile(join(this.root, TAGS_FILE), 'utf8'))
      this.tagColors = colors
      this.tagFileError = error
    } catch (error) {
      this.tagColors = {}
      this.tagFileError = isErrno(error, 'ENOENT')
        ? null
        : `${TAGS_FILE} を読めません：${(error as Error).message}`
    }
    this.tagConflicts.clear()
    try {
      for (const e of await readdir(this.root, { withFileTypes: true })) {
        if (e.isFile() && isTagsConflictFileName(e.name)) this.tagConflicts.add(e.name)
      }
    } catch (error) {
      console.error('[mokkan] tasks フォルダを読めませんでした', error)
    }
  }

  async stop(): Promise<void> {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    await this.watcher?.close()
    this.watcher = null
  }

  /** tickets/ を作り、ルールのファイル（RULE_FILES）がなければ原本を置く（既存のファイルには触れない） */
  async initFolder(): Promise<void> {
    if (!this.tasksDir || !this.ticketsDir) throw new Error('tasks フォルダが選ばれていません')
    await mkdir(this.ticketsDir, { recursive: true })
    for (const { name, content } of RULE_FILES) {
      try {
        await writeFile(join(this.tasksDir, name), content, { flag: 'wx' })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
      }
    }
  }

  /** ルールのファイルが、このアプリの原本と同じかを調べる */
  async checkRuleFiles(): Promise<RuleFileStatus[]> {
    if (!this.tasksDir) throw new Error('tasks フォルダが選ばれていません')
    return Promise.all(
      RULE_FILES.map(async ({ name, content }): Promise<RuleFileStatus> => {
        try {
          const current = await readFile(join(this.tasksDir!, name), 'utf8')
          // 同期やエディタの設定で改行が CRLF になっただけのものは、同じとみなす
          const same = current.replace(/\r\n/g, '\n') === content
          return { name, state: same ? 'same' : 'different' }
        } catch (error) {
          if (isErrno(error, 'ENOENT')) return { name, state: 'missing' }
          throw error
        }
      })
    )
  }

  /**
   * 指定したルールのファイルを原本にする。ないものは置き、違うものは今のファイルを OS のごみ箱に移してから置く
   * @param names RULE_FILES のファイル名。それ以外は受け付けない
   */
  async updateRuleFiles(names: string[]): Promise<RuleFileStatus[]> {
    if (this.folderStatus !== 'ready' || !this.tasksDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    const targets = names.map((name) => {
      const file = RULE_FILES.find((f) => f.name === name)
      if (!file) throw new Error(`ルールのファイルではありません：${name}`)
      return file
    })
    const statuses = await this.checkRuleFiles()
    for (const { name, content } of targets) {
      const state = statuses.find((s) => s.name === name)?.state
      if (state === 'same') continue
      const path = join(this.tasksDir, name)
      if (state === 'different') {
        const trash = this.options.trash
        if (!trash) throw new Error('ごみ箱が使えないので差し替えられません')
        await trash(path)
      }
      try {
        await writeFile(path, content, { flag: 'wx' })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
        // ごみ箱に移してから置くまでの間に、同期などで同じ名前のファイルが現れた
        throw new Error(
          `${name} を置けませんでした。同じ名前のファイルが外部で作られたので、もう一度確かめてください` +
            (state === 'different' ? '（元のファイルはごみ箱にあります）' : ''),
          { cause: error }
        )
      }
    }
    return this.checkRuleFiles()
  }

  /**
   * TEMPLATE.md から新しいチケットを作る。同名のファイルがあるときは書かない（排他的な作成）
   * アプリで作るときだけ、着手日に今日・担当者に自分・タグに絞り込みのタグを初めの値として入れる
   * （TEMPLATE.md と、AI や手で作るときの決まりは変えない）
   * @param author 作成者（設定の「自分の名前」）。空なら author と assignee の行は空のまま
   * @param tags 初めに付けるタグ（絞り込みでタグを1つだけ選んでいるときのそのタグ）
   */
  async createTicket(author = '', tags: string[] = []): Promise<string> {
    const template = await this.readTemplate()
    const { fileName, text } = await this.writeNewFile('ticket', (id, created) =>
      // 項目の行がない古い TEMPLATE.md でも、RULES.md の並び順の位置に足す
      setFields(fillTemplate(template, id, created), {
        ...newTicketDefaults(author, created),
        ...(tags.length > 0 ? { tags } : {})
      })
    )
    this.createdBySelf.set(fileName, text)
    return fileName
  }

  /**
   * NOTE_TEMPLATE.md から新しいノートを作る。`date` には今日を入れる
   * @param author 作成者（設定の「自分の名前」）。空なら author の行は空のまま
   * @returns ノートのキー（`notes/ファイル名`）
   */
  async createNote(author = ''): Promise<string> {
    const template = await this.readNoteTemplate()
    const { fileName, text } = await this.writeNewFile('note', (id, created) =>
      setFields(
        fillTemplate(template, id, created, 'NOTE_TEMPLATE.md'),
        { date: created, ...(author ? { author } : {}) },
        NOTE_FIELD_ORDER
      )
    )
    this.createdBySelf.set(fileName, text)
    return fileName
  }

  /**
   * ノートからチケットを起こし、ノートの「宿題」に `→ [ID](../tickets/ファイル名)` を書き戻す
   * （RULES.md「議事メモからタスクを起こす」）
   * チケットには `source` にノートの id を入れ、ノートのタグを引き継ぐ。ファイル名には初めから見出しを付ける
   * （書き戻すリンクが、起動時の名前の付け足しで切れないように）
   * @param noteBase 画面が最後に読んだノートの中身。ファイルがこれと違えば、何も作らずに conflict を返す
   * @param author 作成者（設定の「自分の名前」）
   * @param options.homeworkItem 「宿題」の項目の文。あればその行の最後に付け、なければ（見つからなければ）新しい行を足す
   * @param options.assignee 担当者（宿題の行の「（高橋）」など）。空なら自分を入れる
   * @param options.due 期限
   */
  async createTicketFromNote(
    noteKey: string,
    noteBase: string,
    title: string,
    author = '',
    options: FromNoteOptions = {}
  ): Promise<FromNoteResult> {
    if (!isNoteKey(noteKey)) throw new Error(`ノートではありません：${noteKey}`)
    const current = await this.readTicket(noteKey)
    if (current === null) throw new Error('ノートが見つかりません')
    if (current !== noteBase) return { status: 'conflict', text: current }
    const note = parseNote(noteKey, current)
    if (!note.id) throw new Error('ノートに id がありません')

    const template = await this.readTemplate()
    let ticketId = ''
    const { fileName } = await this.writeNewFile(
      'ticket',
      (id, created) => {
        ticketId = id
        const filled = setFields(fillTemplate(template, id, created), {
          source: note.id,
          tags: note.tags,
          ...newTicketDefaults(author, created),
          ...(options.assignee && options.assignee.length > 0
            ? { assignee: assigneeField(options.assignee) }
            : {}),
          ...(options.due ? { due: options.due } : {})
        })
        return withTitle(filled, title)
      },
      title
    )

    // チケットを作っている間にノートが外部で変わっていたら、上書きせずに知らせる（作ったチケットは残す）
    const link = `[${ticketId}](${markdownLinkDestination(relativeLinkPath(noteKey, fileName))})`
    const item = `${title} → ${link}`
    const notWritten = (reason: string): FromNoteResult => ({
      status: 'not-written-back',
      fileName,
      line: options.homeworkItem ? `- ${options.homeworkItem} → ${link}` : `- ${item}`,
      reason
    })
    const path = this.ticketPath(noteKey)
    try {
      if ((await readFile(path, 'utf8')) !== current) {
        return notWritten('チケットを作っている間に、ノートが外部で変更されました')
      }
      const noteText =
        (options.homeworkItem && attachHomework(current, options.homeworkItem, ` → ${link}`)) ||
        appendHomework(current, item)
      await writeFile(path, noteText)
      await this.load(path)
      this.scheduleEmit()
      return { status: 'created', fileName, noteText }
    } catch (error) {
      return notWritten(`ノートに書き込めませんでした：${(error as Error).message}`)
    }
  }

  /**
   * 完了した繰り返しのチケットの次回分を作る（RULES.md「完了にするとき」）
   * 次回分を作るのは完了の操作をしたアプリだけ。フォルダの監視では作らない（複数人で重ねて作らないため）
   * 完了を取り消しても、作った次回分は消さない。同じ次回分がすでにあれば作らない
   * @param author 作成者（設定の「自分の名前」）
   */
  createNextRepeat(fileName: string, author = ''): Promise<RepeatResult> {
    // ほぼ同時に呼ばれても二重に作らないよう、「すでにあるか」の確認と作成を1件ずつ順に行う
    const run = this.repeatQueue.then(() => this.createNextRepeatNow(fileName, author))
    this.repeatQueue = run.catch(() => undefined)
    return run
  }

  private async createNextRepeatNow(fileName: string, author: string): Promise<RepeatResult> {
    const current = await this.readTicket(fileName)
    if (current === null) return { status: 'none' }
    const ticket = parseTicket(fileName, current)
    if (ticket.status !== 'done') return { status: 'none' }
    const next = nextSchedule(ticket, validDate(ticket.done) ?? formatDate(new Date()))
    if (!next) return { status: 'none' }
    const existing = findExistingNext(ticket, next, [...this.tickets.values()])
    if (existing) return { status: 'exists', fileName: existing.fileName }

    const template = await this.readTemplate()
    const created = await this.writeNewFile('ticket', (id, today) =>
      buildNextTicket(template, id, today, ticket, next, author)
    )
    return { status: 'created', fileName: created.fileName, ...next }
  }

  /**
   * 新しい ID でチケット（tickets/）かノート（notes/）を書く。同名のファイルがあるときは書かない（排他的な作成）
   * @param title タイトルがわかっていれば、ファイル名に付ける（ID_タイトル.md）
   * @returns キー（ノートは `notes/ファイル名`）と書いた中身
   */
  private async writeNewFile(
    kind: 'ticket' | 'note',
    build: (id: string, created: string) => string,
    title = ''
  ): Promise<{ fileName: string; text: string }> {
    if (this.folderStatus !== 'ready' || !this.ticketsDir || !this.notesDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    const dir = kind === 'note' ? this.notesDir : this.ticketsDir
    if (kind === 'note') await mkdir(dir, { recursive: true })
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const now = new Date()
      const id = generateId(now, randomInt)
      // タイトルがわかっているときは、初めから見出しを付けた名前にする（RULES.md「ファイル名」）
      const name = titledFileName(id, title) ?? `${id}.md`
      // archive/ とノートも含めて、同じ ID のファイルがあれば作り直す（ID はチケットとノートで共通）
      const entries = [...this.tickets.values(), ...this.notes.values()]
      if (entries.some((t) => t.id === id || t.fileId === id)) continue
      const path = join(dir, name)
      const text = build(id, formatDate(now))
      try {
        await writeFile(path, text, { flag: 'wx' })
      } catch (error) {
        if (isErrno(error, 'EEXIST')) continue // IDが重なったらランダムな部分を作り直す
        throw error
      }
      await this.load(path)
      this.scheduleEmit()
      return { fileName: kind === 'note' ? NOTES_PREFIX + name : name, text }
    }
    throw new Error('IDが重ならない名前を作れませんでした')
  }

  /** チケット（またはノート）のファイルの中身を読む。なくなっていたら null */
  async readTicket(fileName: string): Promise<string | null> {
    if (!this.has(fileName)) return null
    try {
      return await readFile(this.ticketPath(fileName), 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    }
  }

  /**
   * チケットを保存する。ファイルの今の中身が baseText と同じときだけ書き込む
   * （最後に読んでから AI や他のエディタ、同期サービスで変わっていたら上書きしない）
   *
   * 限界と、書き込み方を選んだ理由
   * - 確認（読む）と書き込みは別の操作なので、そのわずかな間に外部が書き込むと上書きしてしまう。
   *   ファイルロックは他のツール（AI・エディタ・同期サービス）が従わないので使わず、読んでからすぐ書くことで間隔を短くしている
   * - 一時ファイルに書いて rename で置き換える方法は、書き込み中に落ちても壊れない利点がある。
   *   ただ同期サービスによっては別のファイルとして扱われて版の履歴が切れたり、
   *   Windows では同期やエディタが開いているファイルの置き換えに失敗したりするので、上書きを選んだ
   * - force は「自分の変更で上書きする」を選んだときだけ使う。外部の変更はすべて消える（画面で確認を取る）
   */
  async saveTicket(
    fileName: string,
    baseText: string,
    newText: string,
    force = false
  ): Promise<SaveResult> {
    const current = await this.readTicket(fileName)
    if (current === null) return { status: 'missing' }
    const path = this.ticketPath(fileName)
    if (current !== baseText && !force) return { status: 'conflict', text: current }
    if (current !== newText) {
      await writeFile(path, newText)
      await this.load(path)
      this.scheduleEmit()
    }
    return { status: 'saved', text: newText }
  }

  /**
   * このアプリで作ったばかりで、タイトルも本文も空のまま（ノートはテンプレートのまま）なら削除する
   * 他の人やAIが作ったファイル、作った後に項目を変えたファイルには触れない
   */
  async discardIfEmpty(fileName: string): Promise<boolean> {
    const created = this.createdBySelf.get(fileName)
    const path = created === undefined ? null : this.pathOf(fileName)
    if (created === undefined || path === null) return false
    let current: string
    try {
      current = await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) this.createdBySelf.delete(fileName)
      return false
    }
    const before = splitFrontmatter(created)
    const after = splitFrontmatter(current)
    if (
      !before ||
      !after ||
      before.frontmatter !== after.frontmatter ||
      !(isBlankBody(after.body) || after.body === before.body)
    ) {
      return false
    }
    await unlink(path)
    this.createdBySelf.delete(fileName)
    this.forget(fileName)
    this.scheduleEmit()
    return true
  }

  /** 終了するときなどに、作ったまま空で残っているチケットをまとめて片付ける */
  async discardAllEmpty(): Promise<void> {
    for (const fileName of [...this.createdBySelf.keys()]) {
      try {
        await this.discardIfEmpty(fileName)
      } catch (error) {
        console.error(`[mokkan] ${fileName} を片付けられませんでした`, error)
      }
    }
  }

  /**
   * 完了したチケットを、子孫と一緒に archive/ に移す
   * @returns 元のキーから、移した後のキーへの対応
   * @throws 完了していない・未完了の子孫がある・移す先に同じ名前のファイルがあるとき
   */
  async archiveTicket(key: string): Promise<Record<string, string>> {
    const plan = archivePlan(this.requireTicket(key), [...this.tickets.values()])
    if (!plan.ok) throw new Error(plan.reason)
    return this.moveTickets(plan.tickets, true)
  }

  /**
   * 完了日が cutoff 以前で、子孫もすべて完了しているチケットをまとめて archive/ に移す
   * @returns 元のキーから、移した後のキーへの対応
   */
  async archiveDoneBefore(cutoff: string): Promise<Record<string, string>> {
    return this.moveTickets(bulkArchiveTargets([...this.tickets.values()], cutoff), true)
  }

  /** アーカイブしたチケットを、アーカイブしている子孫と一緒に tickets/ に戻す */
  async restoreTicket(key: string): Promise<Record<string, string>> {
    const targets = restoreTargets(this.requireTicket(key), [...this.tickets.values()])
    if (targets.length === 0) throw new Error('アーカイブしていないチケットです')
    return this.moveTickets(targets, false)
  }

  /**
   * チケットを子孫と一緒に OS のごみ箱に移す（完全には消さない）
   * ノートのキーなら、そのノートだけを移す（起こしたチケットはそのまま残す）
   * @returns ごみ箱に移した件数
   */
  async deleteTicket(key: string): Promise<number> {
    const trash = this.options.trash
    if (!trash) throw new Error('ごみ箱が使えないので削除できません')
    const keys = isNoteKey(key)
      ? [this.requireNote(key).fileName]
      : deleteTargets(this.requireTicket(key), [...this.tickets.values()]).map((t) => t.fileName)
    for (const k of keys) {
      await trash(this.ticketPath(k))
      this.forget(k)
      this.createdBySelf.delete(k)
    }
    this.scheduleEmit()
    return keys.length
  }

  /** 一覧にあるチケット（またはノート）の絶対パスを返す（画面から任意のパスを渡されないようにする） */
  ticketPath(key: string): string {
    const path = this.has(key) ? this.pathOf(key) : null
    if (path === null) throw new Error(`チケットが見つかりません：${key}`)
    return path
  }

  /** キーから絶対パスを作る。キーの形が正しくなければ null */
  private pathOf(key: string): string | null {
    if (!this.ticketsDir || !this.archiveDir || !this.notesDir) return null
    const [dir, name] = key.startsWith(ARCHIVE_PREFIX)
      ? [this.archiveDir, key.slice(ARCHIVE_PREFIX.length)]
      : isNoteKey(key)
        ? [this.notesDir, key.slice(NOTES_PREFIX.length)]
        : [this.ticketsDir, key]
    // キーはファイル名だけ（区切り文字を含まない）。念のため確かめる
    if (basename(name) !== name || !isTicketFileName(name)) return null
    return join(dir, name)
  }

  private has(key: string): boolean {
    return this.tickets.has(key) || this.notes.has(key)
  }

  private forget(key: string): void {
    this.tickets.delete(key)
    this.notes.delete(key)
  }

  private requireNote(key: string): Note {
    const note = this.notes.get(key)
    if (!note) throw new Error(`ノートが見つかりません：${key}`)
    return note
  }

  private requireTicket(key: string): Ticket {
    const ticket = this.tickets.get(key)
    if (!ticket) throw new Error(`チケットが見つかりません：${key}`)
    return ticket
  }

  /**
   * チケットを archive/ と tickets/ の間で移す。移す先に同じ名前のファイルがあれば、どれも移さない
   * 一時ファイルは使わず、rename で移す（同期サービスでもフォルダ間の移動として扱われ、版の履歴が続く）
   *
   * 限界
   * - rename は Windows では移す先の同名のファイルを上書きする。上書きしない移し方（コピーして消す）は
   *   同期サービスで別のファイルになり版の履歴が切れるので使わず、移す直前にもう一度確かめて間隔を短くしている
   * - 複数件を移す途中で失敗すると、それまでに移した分は移ったままになる（エラーで件数を知らせる）
   */
  private async moveTickets(
    tickets: Ticket[],
    toArchive: boolean
  ): Promise<Record<string, string>> {
    if (!this.ticketsDir || !this.archiveDir) throw new Error('tasks フォルダが選ばれていません')
    const destDir = toArchive ? this.archiveDir : this.ticketsDir
    const moves = tickets.map((t) => {
      const from = this.ticketPath(t.fileName)
      const name = basename(from)
      return {
        key: t.fileName,
        from,
        to: join(destDir, name),
        newKey: toArchive ? ARCHIVE_PREFIX + name : name
      }
    })
    const clash = moves.find((m) => existsSync(m.to))
    if (clash) throw new Error(`移す先に同じ名前のファイルがあります：${basename(clash.to)}`)
    if (toArchive && moves.length > 0) await mkdir(destDir, { recursive: true })

    const moved: Record<string, string> = {}
    try {
      for (const m of moves) {
        // 確かめてから移すまでに、同期などで同名のファイルが現れることがあるので、直前にもう一度確かめる
        if (existsSync(m.to)) {
          throw new Error(`移す先に同じ名前のファイルがあります：${basename(m.to)}`)
        }
        await rename(m.from, m.to)
        this.tickets.delete(m.key)
        this.createdBySelf.delete(m.key)
        await this.load(m.to)
        moved[m.key] = m.newKey
      }
    } catch (error) {
      const count = Object.keys(moved).length
      if (count === 0) throw error
      throw new Error(`${count} 件を移したところで止まりました：${(error as Error).message}`, {
        cause: error
      })
    } finally {
      if (Object.keys(moved).length > 0) this.scheduleEmit()
    }
    return moved
  }

  /** ファイルのパスからキーを返す。tickets/・archive/・notes/ の直下の md でなければ null */
  private keyOf(path: string): string | null {
    const full = resolve(path)
    const name = basename(full)
    if (!isTicketFileName(name)) return null
    const dir = dirname(full)
    if (dir === this.ticketsDir) return name
    if (dir === this.archiveDir) return ARCHIVE_PREFIX + name
    if (dir === this.notesDir) return NOTES_PREFIX + name
    return null
  }

  private checkFolder(): FolderStatus {
    if (!this.tasksDir || !this.ticketsDir) return 'unset'
    if (!existsSync(this.tasksDir)) return 'missing'
    if (!existsSync(this.ticketsDir) || !statSync(this.ticketsDir).isDirectory()) {
      return 'not-initialized'
    }
    return 'ready'
  }

  /** tasks/RULES.md を読む。なければ同梱の原本（AI に議事メモからタスクを起こす手順を渡すため） */
  async readRules(): Promise<string> {
    if (!this.tasksDir) return bundledRules
    return this.readTemplateFile('RULES.md', bundledRules)
  }

  private async readTemplate(): Promise<string> {
    return this.readTemplateFile('TEMPLATE.md', bundledTemplate)
  }

  private async readNoteTemplate(): Promise<string> {
    return this.readTemplateFile('NOTE_TEMPLATE.md', bundledNoteTemplate)
  }

  /** フォルダのテンプレートを読む。なければ同梱の原本を使う */
  private async readTemplateFile(name: string, bundled: string): Promise<string> {
    try {
      return await readFile(join(this.tasksDir!, name), 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return bundled
      throw error
    }
  }

  private async load(path: string): Promise<void> {
    const key = this.keyOf(path)
    if (!key) return
    try {
      const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      if (isNoteKey(key)) {
        this.notes.set(key, { ...parseNote(key, text), modified: stats.mtimeMs })
        return
      }
      this.tickets.set(key, {
        // ファイル名の ID はファイル名から読み、キーは archive/ の区別を含めて持つ
        ...parseTicket(basename(path), text),
        fileName: key,
        archived: key.startsWith(ARCHIVE_PREFIX),
        modified: stats.mtimeMs
      })
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        this.forget(key)
      } else {
        // 同期中でロックされているなど。前の内容のまま残し、次の変更通知で読み直す
        console.error(`[mokkan] ${key} を読めませんでした`, error)
      }
    }
  }

  private scheduleEmit(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.onChange(this.getState())
    }, EMIT_DELAY_MS)
  }
}
