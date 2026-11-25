// tasks/ フォルダの読み込み・監視・チケット作成・アーカイブ・削除。ファイルに触るのはここだけ
// ファイルだけがデータなので、ここで持つ一覧はいつでもファイルから作り直せるキャッシュにすぎない

import { watch, type FSWatcher } from 'chokidar'
import { randomInt } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import type {
  AppState,
  CreateNoteRequest,
  FolderStatus,
  FromNoteResult,
  RepeatResult,
  RuleFileStatus,
  SaveResult,
  TemplateKind,
  TemplateList
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
import {
  backlinksOf,
  lintFiles,
  replaceLinkDestination,
  type Backlink,
  type LintEntry,
  type LintItem
} from '../shared/lint'
import { idFromHref, markdownLinkDestination, relativeLinkPath } from '../shared/links'
import {
  COMMON_FOLDER,
  NOTES_DIR,
  appendHomework,
  attachHomework,
  folderNameError,
  hasHomeworkHeading,
  isNoteKey,
  isSafeNoteFolder,
  noteKey,
  parseNote,
  projectTag,
  splitNoteKey,
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
  DAYS_DIR,
  DEFAULT_WORK_HOURS,
  ROUTINE_FILE,
  applyDayEdit,
  dateOfDayFile,
  dayEditError,
  entryLine,
  isValidDate,
  newDayText,
  parseRoutine,
  routineFor,
  routineWorkHours,
  setRoutineWorkHours,
  type DayEdit,
  type WorkHours
} from '../shared/day'
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
import sampleMeeting from '../../templates/samples/notes/meeting.md?raw'
import sampleHowto from '../../templates/samples/notes/howto.md?raw'
import sampleReference from '../../templates/samples/notes/reference.md?raw'
import sampleExplanation from '../../templates/samples/notes/explanation.md?raw'
import sampleIndex from '../../templates/samples/notes/index.md?raw'
import skillTasksFromNote from '../../templates/skills/mokkan-creating-tasks-from-notes/SKILL.md?raw'
import skillIngestKnowledge from '../../templates/skills/mokkan-ingesting-knowledge/SKILL.md?raw'
import skillReviewKnowledge from '../../templates/skills/mokkan-reviewing-knowledge/SKILL.md?raw'
import skillProjectIndex from '../../templates/skills/mokkan-writing-project-indexes/SKILL.md?raw'
import skillTidyTickets from '../../templates/skills/mokkan-tidying-tickets/SKILL.md?raw'
import skillPlanningDays from '../../templates/skills/mokkan-planning-days/SKILL.md?raw'
import { SKILL_NAMES, skillPath, withRuleBundle } from '../shared/ruleFiles'

/** 監視で拾った変更をまとめて画面に送るまでの待ち時間 */
const EMIT_DELAY_MS = 50
/** 検索で返す件数の上限 */
const MAX_SEARCH_HITS = 50
/** notes/ の下のフォルダを読む深さ（notes/ から何段まで。より深いフォルダのノートは読まない） */
export const MAX_NOTE_FOLDER_DEPTH = 9
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

/** skill（AI の作業の手順）の原本。名前は SKILL_NAMES と同じ順 */
const BUNDLED_SKILLS: Record<(typeof SKILL_NAMES)[number], string> = {
  'mokkan-creating-tasks-from-notes': skillTasksFromNote,
  'mokkan-ingesting-knowledge': skillIngestKnowledge,
  'mokkan-reviewing-knowledge': skillReviewKnowledge,
  'mokkan-writing-project-indexes': skillProjectIndex,
  'mokkan-tidying-tickets': skillTidyTickets,
  'mokkan-planning-days': skillPlanningDays
}

/**
 * tasks/ に置くルールのファイルと、その原本（名前は tasks/ からのパス）
 * CLAUDE.md（Claude Code が読む）と AGENTS.md（ほかの多くの AI ツールが読む）は、同じ原本（AI_GUIDE.md）から作る
 * skill は `.claude/skills/<名前>/SKILL.md`（Claude Code と Cursor が読む）。RULES.md と一緒に更新する（withRuleBundle）
 */
export const RULE_FILES: ReadonlyArray<{ name: string; content: string }> = [
  { name: 'RULES.md', content: bundledRules },
  { name: 'TEMPLATE.md', content: bundledTemplate },
  { name: 'NOTE_TEMPLATE.md', content: bundledNoteTemplate },
  { name: 'CLAUDE.md', content: bundledAiGuide },
  { name: 'AGENTS.md', content: bundledAiGuide },
  ...SKILL_NAMES.map((name) => ({ name: skillPath(name), content: BUNDLED_SKILLS[name] }))
]

/** テンプレートを置くフォルダ（tasks/ の中）と、その中の種類ごとのフォルダ */
export const TEMPLATES_DIR = 'templates'
const TEMPLATE_SUBDIRS: Record<TemplateKind, string> = { ticket: 'tickets', note: 'notes' }

/**
 * アプリが置くテンプレートの見本（tasks/ からのパス）。ないときだけ置き、すでにあるファイルには触れない
 * 手で直しても「原本と違う」にはしない（自分の使い方に合わせて直してもらうものなので）
 */
export const SAMPLE_TEMPLATES: ReadonlyArray<{ name: string; content: string }> = [
  { name: `${TEMPLATES_DIR}/notes/議事メモ.md`, content: sampleMeeting },
  { name: `${TEMPLATES_DIR}/notes/手順.md`, content: sampleHowto },
  { name: `${TEMPLATES_DIR}/notes/参照.md`, content: sampleReference },
  { name: `${TEMPLATES_DIR}/notes/解説.md`, content: sampleExplanation },
  { name: `${TEMPLATES_DIR}/notes/入口.md`, content: sampleIndex }
]

/** テンプレートの名前（ファイル名から .md を除いたもの）として読むファイルか */
function templateNameOf(fileName: string): string | null {
  return isTicketFileName(fileName) ? fileName.slice(0, -'.md'.length) : null
}

/**
 * テンプレートを埋めた中身の、まだ値のない項目にだけ初めの値を入れる
 * （テンプレートに値が書いてある項目は、テンプレートの値のまま。タグは両方を合わせる）
 */
function setDefaultsWhereEmpty(
  text: string,
  defaults: FieldUpdates,
  order?: Parameters<typeof setFields>[2]
): string {
  let current: Record<string, unknown> = {}
  try {
    const parsed = parse(splitFrontmatter(text)?.frontmatter ?? '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
  } catch {
    // 読めない frontmatter なら、初めの値をそのまま入れる
  }
  const empty = (v: unknown): boolean =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
  const updates: FieldUpdates = {}
  for (const [key, value] of Object.entries(defaults) as [
    keyof FieldUpdates,
    FieldUpdates[keyof FieldUpdates]
  ][]) {
    const now = current[key]
    if (key === 'tags' && Array.isArray(value) && Array.isArray(now) && now.length > 0) {
      updates.tags = [...new Set([...now.map(String), ...value])]
    } else if (empty(now)) {
      updates[key] = value
    }
  }
  return setFields(text, updates, order)
}

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
  /** notes/ の下のフォルダ（`案件A/定例` の形。空のフォルダも含む） */
  private readonly noteFolders = new Set<string>()
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
  private readonly daysDir: string | null
  /** days/ のファイル（日付か 'routine'）と更新日時。中身は持たず、画面が開くときに読む */
  private readonly days = new Map<string, number>()
  /** 時間割の書き換えを、1件ずつ順に行うための待ち行列 */
  private dayQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly tasksDir: string | null,
    private readonly onChange: (state: AppState) => void,
    private readonly options: TaskStoreOptions = {}
  ) {
    this.root = tasksDir ? resolve(tasksDir) : null
    this.ticketsDir = tasksDir ? resolve(tasksDir, 'tickets') : null
    this.archiveDir = tasksDir ? resolve(tasksDir, ARCHIVE_DIR) : null
    this.notesDir = tasksDir ? resolve(tasksDir, NOTES_DIR) : null
    this.daysDir = tasksDir ? resolve(tasksDir, DAYS_DIR) : null
  }

  getState(): AppState {
    const tickets = [...this.tickets.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
    const notes = [...this.notes.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
    return {
      tasksDir: this.tasksDir,
      folderStatus: this.folderStatus,
      tickets,
      notes,
      noteFolders: [...this.noteFolders].sort((a, b) => a.localeCompare(b, 'ja')),
      tagColors: { ...this.tagColors },
      tagFile: { error: this.tagFileError, conflicts: [...this.tagConflicts].sort() },
      renamedOnStart: this.renamedOnStart,
      days: Object.fromEntries(this.days)
    }
  }

  /** フォルダの状態を調べ、使える状態なら全件読み込んで監視を始める */
  async start(): Promise<void> {
    this.folderStatus = this.checkFolder()
    if (this.folderStatus !== 'ready' || !this.ticketsDir) return

    // 監視の準備ができてから全件を読む。逆の順だと、その間に起きた変更を取りこぼす
    // tickets/・archive/ の直下と、notes/ の下（フォルダの中も）を監視する
    // （archive/ と notes/ は後から作られることがあるので、tasks/ から監視し、ほかのフォルダは ignored で除く）
    const root = this.root!
    const dirs = new Set([root, this.ticketsDir, this.archiveDir, this.notesDir, this.daysDir])
    this.watcher = watch(root, {
      ignoreInitial: true,
      // tasks/ → notes/ → フォルダ（MAX_NOTE_FOLDER_DEPTH 段）の中のファイルまで。
      // 深さを決めないと（chokidar の既定は無制限）、Windows で変更の通知が数秒遅れることがあった
      depth: MAX_NOTE_FOLDER_DEPTH + 1,
      // 同期サービスやエディタが書き込み途中のファイルを読まないよう、落ち着くまで待つ
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      // chokidar は Windows でも `C:/...` の形でパスを渡すので、正規化してから比べる
      ignored: (path) =>
        !dirs.has(resolve(path)) &&
        this.noteFolderOf(path) === null &&
        this.keyOf(path) === null &&
        !this.isTagsPath(path) &&
        this.dayNameOf(path) === null
    })
    this.watcher
      .on('add', (path) => void this.loadAny(path).then(() => this.scheduleEmit()))
      .on('change', (path) => void this.loadAny(path).then(() => this.scheduleEmit()))
      .on('unlink', (path) => {
        const key = this.keyOf(path)
        if (key) this.forget(key)
        const day = this.dayNameOf(path)
        if (day) this.days.delete(day)
        const done = this.isTagsPath(path) ? this.loadTags() : Promise.resolve()
        void done.then(() => this.scheduleEmit())
      })
      .on('addDir', (path) => {
        const folder = this.noteFolderOf(path)
        if (folder) {
          this.noteFolders.add(folder)
          this.scheduleEmit()
        }
      })
      .on('unlinkDir', (path) => {
        const folder = this.noteFolderOf(path)
        if (!folder) return
        // フォルダごと消えた・移ったときは、中のフォルダとノートも一覧から外す（ファイルごとの unlink が来ないことがあるため）
        for (const f of [...this.noteFolders]) {
          if (f === folder || f.startsWith(`${folder}/`)) this.noteFolders.delete(f)
        }
        for (const note of [...this.notes.values()]) {
          if (note.folder === folder || note.folder.startsWith(`${folder}/`)) {
            this.forget(note.fileName)
          }
        }
        this.scheduleEmit()
      })
      .on('error', (error) => console.error('[mokkan] ファイル監視のエラー', error))
    await new Promise<void>((done) => this.watcher?.once('ready', () => done()))

    for (const dir of [this.ticketsDir, this.archiveDir]) {
      if (!dir || !existsSync(dir)) continue
      const entries = await readdir(dir, { withFileTypes: true })
      await Promise.all(
        entries
          .filter((e) => e.isFile() && isTicketFileName(e.name))
          .map((e) => this.load(join(dir, e.name)))
      )
    }
    if (this.notesDir && existsSync(this.notesDir)) await this.loadNotesIn(this.notesDir)
    await this.loadTags()
    if (this.daysDir && existsSync(this.daysDir)) {
      const entries = await readdir(this.daysDir, { withFileTypes: true })
      await Promise.all(
        entries.filter((e) => e.isFile()).map((e) => this.loadDay(join(this.daysDir!, e.name)))
      )
    }
  }

  /** days/ の直下の日のファイル（`2026-11-24.md`）なら日付、routine.md なら 'routine'。そうでなければ null */
  private dayNameOf(path: string): string | null {
    if (!this.daysDir) return null
    const full = resolve(path)
    if (dirname(full) !== this.daysDir) return null
    const name = basename(full)
    if (name === ROUTINE_FILE) return 'routine'
    return dateOfDayFile(name)
  }

  /** 日のファイルの更新日時を覚え直す（中身は画面が開くときに読む） */
  private async loadDay(path: string): Promise<void> {
    const day = this.dayNameOf(path)
    if (!day) return
    try {
      this.days.set(day, (await stat(path)).mtimeMs)
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error
      this.days.delete(day)
    }
  }

  private dayPath(day: string): string {
    if (!this.daysDir || (day !== 'routine' && !isValidDate(day))) {
      throw new Error(`時間割の日付が正しくありません：${day}`)
    }
    return join(this.daysDir, day === 'routine' ? ROUTINE_FILE : `${day}.md`)
  }

  private async readOptional(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    }
  }

  /**
   * その日の時間割（days/YYYY-MM-DD.md）といつもの予定（days/routine.md）の中身を読む。ないものは null
   */
  async readDay(date: string): Promise<{ text: string | null; routine: string | null }> {
    const [text, routine] = await Promise.all([
      this.readOptional(this.dayPath(date)),
      this.readOptional(this.dayPath('routine'))
    ])
    return { text, routine }
  }

  /** 作業する時間（days/routine.md の frontmatter の work）。ない・読めないときは 9:00〜18:00 */
  async readWorkHours(): Promise<WorkHours> {
    if (!this.daysDir) return DEFAULT_WORK_HOURS
    return routineWorkHours(await this.readOptional(this.dayPath('routine'))) ?? DEFAULT_WORK_HOURS
  }

  /**
   * 作業する時間を days/routine.md の frontmatter の work に書く（その行だけを書き換える。なければ作る）。
   * 時間割の書き換えと同じ待ち行列で1件ずつ行う
   */
  saveWorkHours(hours: WorkHours): Promise<void> {
    const run = this.dayQueue.then(() => this.saveWorkHoursNow(hours))
    this.dayQueue = run.catch(() => undefined)
    return run
  }

  private async saveWorkHoursNow(hours: WorkHours): Promise<void> {
    if (this.folderStatus !== 'ready' || !this.daysDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    const path = this.dayPath('routine')
    const current = await this.readOptional(path)
    const next = setRoutineWorkHours(current, hours)
    if (current === null) {
      await mkdir(this.daysDir, { recursive: true })
      // 同期などで現れていたら上書きせず、読み直して書き換える
      try {
        await writeFile(path, next, { flag: 'wx' })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
        const appeared = await this.readOptional(path)
        await writeFile(path, setRoutineWorkHours(appeared, hours))
      }
    } else if (next !== current) {
      await writeFile(path, next)
    }
    await this.loadDay(path)
    this.scheduleEmit()
  }

  /**
   * その日の時間割を書き換える。ファイルの今の中身が base（画面が最後に読んだ中身。なかったなら null）と
   * 同じときだけ書く。ファイルがなければ作り、今日か先の日ならいつもの予定（routine.md）の当たる行を写す
   * @param today 今日（YYYY-MM-DD。いつもの予定を写すかを決める）
   */
  updateDay(date: string, base: string | null, edit: DayEdit, today: string): Promise<SaveResult> {
    const run = this.dayQueue.then(() => this.updateDayNow(date, base, edit, today))
    this.dayQueue = run.catch(() => undefined)
    return run
  }

  private async updateDayNow(
    date: string,
    base: string | null,
    edit: DayEdit,
    today: string
  ): Promise<SaveResult> {
    if (this.folderStatus !== 'ready' || !this.daysDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    if (!isValidDate(date)) throw new Error(`時間割の日付が正しくありません：${date}`)
    const invalid = dayEditError(edit)
    if (invalid) throw new Error(invalid)
    const path = this.dayPath(date)
    const current = await this.readOptional(path)
    if (current !== base) return { status: 'conflict', text: current ?? '' }

    let text = current
    if (text === null) {
      const routine = date >= today ? await this.readOptional(this.dayPath('routine')) : null
      const lines = routine
        ? routineFor(parseRoutine(routine), date).map((r) => entryLine(r.start, r.end, r.content))
        : []
      text = newDayText(date, lines)
    }
    const next = applyDayEdit(text, edit)
    if (next === null) return { status: 'conflict', text: current ?? '' }
    // 中身が変わらない（ファイルがあるときの touch など）なら書かない（更新日時も変えない）
    if (next === current) return { status: 'saved', text: next }
    if (current === null) {
      await mkdir(this.daysDir, { recursive: true })
      // 同じ日のファイルが同期などで現れていたら上書きしない
      try {
        await writeFile(path, next, { flag: 'wx' })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
        return { status: 'conflict', text: (await this.readOptional(path)) ?? '' }
      }
    } else {
      await writeFile(path, next)
    }
    await this.loadDay(path)
    this.scheduleEmit()
    return { status: 'saved', text: next }
  }

  /** notes/ の中のフォルダを1つ読み、その下のフォルダもたどる（隠しフォルダは除く） */
  private async loadNotesIn(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries.map(async (e) => {
        const path = join(dir, e.name)
        if (e.isFile() && isTicketFileName(e.name)) {
          await this.load(path)
        } else if (e.isDirectory()) {
          const folder = this.noteFolderOf(path)
          if (folder === null) return
          this.noteFolders.add(folder)
          await this.loadNotesIn(path)
        }
      })
    )
  }

  /**
   * notes/ の下のフォルダのパスなら、notes/ からのフォルダ（`案件A/定例` の形）を返す
   * notes/ そのもの・notes/ の外・隠しフォルダ（とその中）・MAX_NOTE_FOLDER_DEPTH 段より深いフォルダなら null
   */
  private noteFolderOf(path: string): string | null {
    if (!this.notesDir) return null
    const rel = relative(this.notesDir, resolve(path))
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    const folder = rel.split(sep).join('/')
    return isSafeNoteFolder(folder) && folder.split('/').length <= MAX_NOTE_FOLDER_DEPTH
      ? folder
      : null
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

  /** チケット・ノート・アーカイブの中身を読む（検索と同じく、呼ばれるたびに読む）。読めないファイルは飛ばす */
  private async readEntries(): Promise<LintEntry[]> {
    const files = [...this.tickets.values(), ...this.notes.values()]
    const entries = await Promise.all(
      files.map(async (file) => {
        try {
          return { file, text: await readFile(this.ticketPath(file.fileName), 'utf8') }
        } catch {
          // 同期中で読めない・消えたなど。次に呼ばれたときにまた読む
          return null
        }
      })
    )
    return entries.filter((e): e is LintEntry => e !== null)
  }

  /**
   * ノートの点検（切れたリンク・見直していない知識など）。結果は持ち続けず、ファイルにも書かない
   * @param today 今日（`YYYY-MM-DD`）。既定は現地時刻の今日
   */
  async lint(today = formatDate(new Date())): Promise<LintItem[]> {
    if (this.folderStatus !== 'ready') return []
    return lintFiles(await this.readEntries(), today)
  }

  /** そのチケット・ノートへのリンク（本文の md のリンクと ID）があるファイル */
  async backlinks(key: string): Promise<Backlink[]> {
    if (this.folderStatus !== 'ready' || !this.has(key)) return []
    return backlinksOf(key, await this.readEntries())
  }

  /**
   * ずれたリンク（点検で見つけたもの）を、リンク先の今のファイルへの相対パスに書き換える
   * 人が「直す」を押したときだけ呼ぶ。そのリンク先のリンクのほかは1文字も変えない
   * @param href ファイルに書いてあるリンク先
   * @throws リンクやリンク先が見つからない・書き換えている間にファイルが変わったとき
   */
  async fixLink(key: string, href: string): Promise<void> {
    const id = idFromHref(href)
    const target = id
      ? [...this.tickets.values(), ...this.notes.values()].find(
          (f) => f.id === id || f.fileId === id
        )
      : undefined
    if (!target) throw new Error('リンク先のチケット・ノートが見つかりません')
    const text = await this.readTicket(key)
    if (text === null) throw new Error('リンクのあるファイルが見つかりません')
    const fixed = replaceLinkDestination(text, href, relativeLinkPath(key, target.fileName))
    if (fixed === null)
      throw new Error('リンクが見つかりません（すでに直したか、書き換えられています）')
    const result = await this.saveTicket(key, text, fixed)
    if (result.status !== 'saved') {
      throw new Error(
        '直している間にファイルが変わったので、書き換えませんでした。もう一度点検してください'
      )
    }
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
    else if (this.dayNameOf(path)) await this.loadDay(path)
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

  /**
   * tickets/ と notes/共通/ を作り、ルールのファイル（RULE_FILES）とテンプレートの見本（SAMPLE_TEMPLATES）が
   * なければ原本を置く（既存のファイルには触れない）
   */
  async initFolder(): Promise<void> {
    if (!this.tasksDir || !this.ticketsDir || !this.notesDir) {
      throw new Error('tasks フォルダが選ばれていません')
    }
    await mkdir(this.ticketsDir, { recursive: true })
    await mkdir(join(this.notesDir, COMMON_FOLDER), { recursive: true })
    for (const { name, content } of [...RULE_FILES, ...SAMPLE_TEMPLATES]) {
      const path = join(this.tasksDir, ...name.split('/'))
      await mkdir(dirname(path), { recursive: true })
      try {
        await writeFile(path, content, { flag: 'wx' })
      } catch (error) {
        if (!isErrno(error, 'EEXIST')) throw error
      }
    }
  }

  /**
   * ルールのファイルが、このアプリの原本と同じかを調べる
   * テンプレートの見本は、あるかないかだけを調べる（あれば中身を問わず same）
   */
  async checkRuleFiles(): Promise<RuleFileStatus[]> {
    if (!this.tasksDir) throw new Error('tasks フォルダが選ばれていません')
    const files = [
      ...RULE_FILES.map((f) => ({ ...f, sample: false })),
      ...SAMPLE_TEMPLATES.map((f) => ({ ...f, sample: true }))
    ]
    return Promise.all(
      files.map(async ({ name, content, sample }): Promise<RuleFileStatus> => {
        try {
          const current = await readFile(join(this.tasksDir!, ...name.split('/')), 'utf8')
          // 同期やエディタの設定で改行が CRLF になっただけのものは、同じとみなす
          const same = sample || current.replace(/\r\n/g, '\n') === content
          return { name, state: same ? 'same' : 'different', sample }
        } catch (error) {
          if (isErrno(error, 'ENOENT')) return { name, state: 'missing', sample }
          throw error
        }
      })
    )
  }

  /**
   * 指定したルールのファイルを原本にする。ないものは置き、違うものは今のファイルを OS のごみ箱に移してから置く
   * テンプレートの見本は、ないときだけ置く。RULES.md か skill を選んだら、RULES.md と skill をすべて一緒に更新する
   * @param names RULE_FILES・SAMPLE_TEMPLATES の名前。それ以外は受け付けない
   */
  async updateRuleFiles(names: string[]): Promise<RuleFileStatus[]> {
    if (this.folderStatus !== 'ready' || !this.tasksDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    const known = [...RULE_FILES, ...SAMPLE_TEMPLATES]
    const expanded = withRuleBundle(
      names,
      known.map((f) => f.name)
    )
    const targets = expanded.map((name) => {
      const file = known.find((f) => f.name === name)
      if (!file) throw new Error(`ルールのファイルではありません：${name}`)
      return file
    })
    const statuses = await this.checkRuleFiles()
    for (const { name, content } of targets) {
      const state = statuses.find((s) => s.name === name)?.state
      if (state === 'same') continue
      const path = join(this.tasksDir, ...name.split('/'))
      await mkdir(dirname(path), { recursive: true })
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
   * テンプレートから新しいチケットを作る。同名のファイルがあるときは書かない（排他的な作成）
   * アプリで作るときだけ、着手日に今日・担当者に自分・タグに絞り込みのタグを初めの値として入れる
   * （テンプレートに値が書いてある項目はそのまま。TEMPLATE.md と、AI や手で作るときの決まりは変えない）
   * @param author 作成者（設定の「自分の名前」）。空なら author と assignee の行は空のまま
   * @param tags 初めに付けるタグ（絞り込みでタグを1つだけ選んでいるときのそのタグ）
   * @param templateName tasks/templates/tickets/ のテンプレートの名前。null なら TEMPLATE.md
   */
  async createTicket(
    author = '',
    tags: string[] = [],
    templateName: string | null = null
  ): Promise<string> {
    const template = await this.readChosenTemplate('ticket', templateName)
    const { fileName, text } = await this.writeNewFile('ticket', (id, created) =>
      // 項目の行がない古い TEMPLATE.md でも、RULES.md の並び順の位置に足す
      setDefaultsWhereEmpty(template.fill(id, created), {
        ...newTicketDefaults(author, created),
        ...(tags.length > 0 ? { tags } : {})
      })
    )
    this.createdBySelf.set(fileName, text)
    return fileName
  }

  /**
   * テンプレートから新しいノートを作る。`date` には今日、知識のノートは `reviewed` にも今日を入れる
   * @param author 作成者（設定の「自分の名前」）。空なら author の行は空のまま
   * @param request.template tasks/templates/notes/ のテンプレートの名前。null なら NOTE_TEMPLATE.md
   * @param request.folder 作る先の notes/ の中のフォルダ（あるフォルダだけ）。空文字なら notes/ の直下
   * @returns ノートのキー（`notes/…/ファイル名`）
   */
  async createNote(author = '', request: CreateNoteRequest = {}): Promise<string> {
    const folder = request.folder ?? ''
    if (folder !== '' && !this.noteFolders.has(folder)) {
      throw new Error(`フォルダが見つかりません：${folder}`)
    }
    const template = await this.readChosenTemplate('note', request.template ?? null)
    const { fileName, text } = await this.writeNewFile(
      'note',
      (id, created) => {
        const filled = template.fill(id, created)
        const knowledge = parseNote('x.md', filled).type === 'knowledge'
        const text = setDefaultsWhereEmpty(
          setFields(filled, { date: validDate(request.date ?? null) ?? created }, NOTE_FIELD_ORDER),
          { ...(knowledge ? { reviewed: created } : {}), ...(author ? { author } : {}) },
          NOTE_FIELD_ORDER
        )
        return request.title ? withTitle(text, request.title) : text
      },
      request.title ?? '',
      folder
    )
    this.createdBySelf.set(fileName, text)
    return fileName
  }

  /** tasks/templates/ のテンプレートの名前を読む（フォルダがなければ空） */
  async listTemplates(): Promise<TemplateList> {
    const [tickets, notes] = await Promise.all([
      this.listTemplateNames('ticket'),
      this.listTemplateNames('note')
    ])
    return { tickets, notes }
  }

  private async listTemplateNames(kind: TemplateKind): Promise<string[]> {
    if (!this.root) return []
    try {
      const entries = await readdir(join(this.root, TEMPLATES_DIR, TEMPLATE_SUBDIRS[kind]), {
        withFileTypes: true
      })
      return entries
        .filter((e) => e.isFile())
        .map((e) => templateNameOf(e.name))
        .filter((n): n is string => n !== null)
        .sort((a, b) => a.localeCompare(b, 'ja'))
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return []
      throw error
    }
  }

  /**
   * 新規作成に使うテンプレートを読み、id と created を入れる関数を返す
   * 既定（TEMPLATE.md・NOTE_TEMPLATE.md）は `id:` `created:` の行がなければエラーにする（RULES.md の決まり）。
   * tasks/templates/ のテンプレートは、行がなければ足す
   * @param name tasks/templates/ のテンプレートの名前。null なら既定。一覧にない名前は受け付けない
   */
  private async readChosenTemplate(
    kind: TemplateKind,
    name: string | null
  ): Promise<{ fill: (id: string, created: string) => string }> {
    if (name === null) {
      const template = kind === 'ticket' ? await this.readTemplate() : await this.readNoteTemplate()
      const label = kind === 'ticket' ? 'TEMPLATE.md' : 'NOTE_TEMPLATE.md'
      return { fill: (id, created) => fillTemplate(template, id, created, label) }
    }
    // 画面から来た名前でパスを作らないよう、フォルダにあるテンプレートの名前と同じものだけを使う
    if (!(await this.listTemplateNames(kind)).includes(name)) {
      throw new Error(`テンプレート「${name}」が見つかりません`)
    }
    const text = await readFile(
      join(this.root!, TEMPLATES_DIR, TEMPLATE_SUBDIRS[kind], `${name}.md`),
      'utf8'
    )
    if (!splitFrontmatter(text)) {
      throw new Error(
        `テンプレート「${name}」に frontmatter（先頭の --- で囲んだ部分）がありません`
      )
    }
    const order = kind === 'note' ? NOTE_FIELD_ORDER : undefined
    return { fill: (id, created) => setFields(text, { id, created }, order) }
  }

  /**
   * notes/ の中にフォルダを作る（すでにあれば作らない）
   * @param parent 作る場所（notes/ の中のあるフォルダ。空文字なら notes/ の直下）
   * @returns 作ったフォルダ（`案件A/定例` の形）
   */
  async createNoteFolder(parent: string, name: string): Promise<string> {
    if (this.folderStatus !== 'ready' || !this.notesDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    if (parent !== '' && !this.noteFolders.has(parent)) {
      throw new Error(`フォルダが見つかりません：${parent}`)
    }
    const trimmed = name.trim()
    const error = folderNameError(trimmed)
    if (error) throw new Error(error)
    const folder = parent ? `${parent}/${trimmed}` : trimmed
    if (folder.split('/').length > MAX_NOTE_FOLDER_DEPTH) {
      throw new Error(`フォルダは notes/ から${MAX_NOTE_FOLDER_DEPTH}段までにしてください`)
    }
    const path = join(this.notesDir, ...folder.split('/'))
    if (existsSync(path)) throw new Error(`同じ名前のフォルダかファイルがあります：${folder}`)
    await mkdir(path, { recursive: true })
    this.noteFolders.add(folder)
    this.scheduleEmit()
    return folder
  }

  /**
   * ノートを notes/ の中の別のフォルダに移す。ファイル名は変えず、rename で移す（moveTickets と同じ理由）
   * 本文のリンクの相対パスは書き換えない（アプリはリンク先の ID で開くので切れないが、ほかのエディタでは切れる）
   * @param folder 移す先（notes/ の中のあるフォルダ。空文字なら notes/ の直下）
   * @returns 元のキーから、移した後のキーへの対応（同じフォルダなら空）
   */
  async moveNote(key: string, folder: string): Promise<Record<string, string>> {
    const note = this.requireNote(key)
    if (folder !== '' && !this.noteFolders.has(folder)) {
      throw new Error(`フォルダが見つかりません：${folder}`)
    }
    if (note.folder === folder) return {}
    const from = this.ticketPath(key)
    const name = basename(from)
    const newKey = noteKey(folder, name)
    const to = this.pathOf(newKey)
    if (!to) throw new Error(`移せない場所です：${folder}`)
    // rename は Windows では同じ名前のファイルを上書きするので、直前に確かめる
    if (existsSync(to)) throw new Error(`移す先に同じ名前のファイルがあります：${name}`)
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
    this.forget(key)
    this.createdBySelf.delete(key)
    await this.load(to)
    this.scheduleEmit()
    return { [key]: newKey }
  }

  /**
   * ノートからチケットを起こし、ノートの「宿題」に `→ [ID](../tickets/ファイル名)` を書き戻す
   * （skill mokkan-creating-tasks-from-notes の手順と同じ）
   * 書き戻すのは「宿題」の見出しがあるノートだけ（知識のノートなどにリンクを書き足さない）
   * チケットには `source` にノートの id を入れ、ノートのタグと、ノートのプロジェクトのタグ
   * （notes/ の直下のフォルダ名。共通/ を除く）を付ける。ファイル名には初めから見出しを付ける
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
    const project = projectTag(note.folder)
    const tags = project && !note.tags.includes(project) ? [...note.tags, project] : note.tags
    let ticketId = ''
    const { fileName } = await this.writeNewFile(
      'ticket',
      (id, created) => {
        ticketId = id
        const filled = setFields(fillTemplate(template, id, created), {
          source: note.id,
          tags,
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
    // 「宿題」の見出しがないノートには書き戻さない（チケットの source からノートに戻れる）
    if (!hasHomeworkHeading(current)) {
      return { status: 'created', fileName, noteText: current }
    }

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
   * チケットを完了にする（`status: done` と `done` に今日）。変えるのはその2つの行だけ。
   * 繰り返しがあれば次回分も作る（時間割の「完了」から使う。編集画面で完了にするときと同じ結果にする）
   * @returns 次回分を作った結果。すでに完了していれば何も変えない
   */
  async completeTicket(fileName: string, today: string, author = ''): Promise<RepeatResult> {
    if (fileName.startsWith(ARCHIVE_PREFIX) || isNoteKey(fileName)) {
      throw new Error('アーカイブしたチケットとノートは完了にできません')
    }
    const current = await this.readTicket(fileName)
    if (current === null) throw new Error(`チケットが見つかりません：${fileName}`)
    if (parseTicket(fileName, current).status !== 'done') {
      const result = await this.saveTicket(
        fileName,
        current,
        setFields(current, { status: 'done', done: today })
      )
      if (result.status !== 'saved') {
        throw new Error(
          'チケットがちょうど書き換えられたので、完了にできませんでした。もう一度試してください'
        )
      }
    }
    return this.createNextRepeat(fileName, author)
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
   * @param folder ノートを作る notes/ の中のフォルダ（呼ぶ側で、あるフォルダかを確かめておく）
   * @returns キー（ノートは `notes/…/ファイル名`）と書いた中身
   */
  private async writeNewFile(
    kind: 'ticket' | 'note',
    build: (id: string, created: string) => string,
    title = '',
    folder = ''
  ): Promise<{ fileName: string; text: string }> {
    if (this.folderStatus !== 'ready' || !this.ticketsDir || !this.notesDir) {
      throw new Error('tasks フォルダが使える状態ではありません')
    }
    if (!isSafeNoteFolder(folder)) throw new Error(`フォルダの名前が正しくありません：${folder}`)
    const dir =
      kind === 'note' ? join(this.notesDir, ...(folder ? folder.split('/') : [])) : this.ticketsDir
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
      return { fileName: kind === 'note' ? noteKey(folder, name) : name, text }
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
    if (isNoteKey(key)) {
      // ノートは notes/ の中のフォルダを含む。notes/ の外を指さないよう、フォルダの形も確かめる
      const { folder, name } = splitNoteKey(key)
      if (!isSafeNoteFolder(folder) || basename(name) !== name || !isTicketFileName(name)) {
        return null
      }
      return join(this.notesDir, ...(folder ? folder.split('/') : []), name)
    }
    const [dir, name] = key.startsWith(ARCHIVE_PREFIX)
      ? [this.archiveDir, key.slice(ARCHIVE_PREFIX.length)]
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

  /**
   * ファイルのパスからキーを返す
   * tickets/・archive/ の直下の md と、notes/ の下（隠しフォルダを除くフォルダの中も）の md でなければ null
   */
  private keyOf(path: string): string | null {
    const full = resolve(path)
    const name = basename(full)
    if (!isTicketFileName(name)) return null
    const dir = dirname(full)
    if (dir === this.ticketsDir) return name
    if (dir === this.archiveDir) return ARCHIVE_PREFIX + name
    if (dir === this.notesDir) return noteKey('', name)
    const folder = this.noteFolderOf(dir)
    return folder === null ? null : noteKey(folder, name)
  }

  private checkFolder(): FolderStatus {
    if (!this.tasksDir || !this.ticketsDir) return 'unset'
    if (!existsSync(this.tasksDir)) return 'missing'
    if (!existsSync(this.ticketsDir) || !statSync(this.ticketsDir).isDirectory()) {
      return 'not-initialized'
    }
    return 'ready'
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
