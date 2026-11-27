import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  ChartGantt,
  CircleHelp,
  Clock,
  FolderInput,
  FolderOpen,
  List,
  NotebookText,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { AppState, Onboarding, TemplateKind, TemplateList } from '../../shared/api'
import {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  collectAssignees,
  collectTags,
  findWarnings,
  formatDate,
  listTickets,
  type ListFilter,
  type ListSort
} from '../../shared/ticket'
import { listNotes, type NoteType } from '../../shared/note'
import { calendarItems, ganttRows, groupingKey, type GanttGrouping } from '../../shared/schedule'
import { tagKeys } from '../../shared/tagKey'
import CalendarView from './components/CalendarView'
import FilterBar from './components/FilterBar'
import GanttView from './components/GanttView'
import TimetableView from './components/TimetableView'
import FolderSetup from './components/FolderSetup'
import SearchBox from './components/SearchBox'
import SettingsDialog from './components/SettingsDialog'
import ArchiveDialog from './components/ArchiveDialog'
import TicketEditor from './components/TicketEditor'
import { afterClose } from './editor/closing'
import NoteList from './components/NoteList'
import NoteLintPanel from './components/NoteLintPanel'
import NoteFolderTree from './components/NoteFolderTree'
import NewButton from './components/NewButton'
import TicketList from './components/TicketList'
import WarningList from './components/WarningList'
import PaneSplitter from './components/PaneSplitter'
import HelpDialog from './components/HelpDialog'
import type { HelpTopic } from '../../shared/help'
import type { PaneView, PaneWidths } from '../../shared/paneWidth'
import { isBackKey, isModKey } from './keys'

type View = PaneView

/** 「← 戻る」で覚えておく数 */
const MAX_HISTORY = 50

const VIEWS: readonly View[] = ['list', 'calendar', 'gantt', 'timetable', 'notes']
const VIEW_LABELS: Record<View, string> = {
  list: '一覧',
  calendar: 'カレンダー',
  gantt: 'ガント',
  timetable: '時間割',
  notes: 'ノート'
}

/** 上の帯の、表示の切り替えのアイコン（帯が狭いときはアイコンだけにする） */
const VIEW_ICONS: Record<View, LucideIcon> = {
  list: List,
  calendar: CalendarDays,
  gantt: ChartGantt,
  timetable: Clock,
  notes: NotebookText
}

/** 編集画面で開いているチケット */
interface Selection {
  fileName: string
  /** このアプリで作ったばかりか（空のまま閉じたら削除する） */
  isNew: boolean
}

function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [filter, setFilter] = useState<ListFilter>(DEFAULT_FILTER)
  const [sort, setSort] = useState<ListSort>(DEFAULT_SORT)
  const [view, setView] = useState<View>('list')
  const [grouping, setGrouping] = useState<GanttGrouping>('parent')
  const [error, setError] = useState<string | null>(null)
  /** 見出しを付けたことの案内を閉じたフォルダ（フォルダを変えた先で付けたら、また出す） */
  const [renameNoticeClosedFor, setRenameNoticeClosedFor] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.onStateChange(setState)
    window.api.getState().then(setState)
    return unsubscribe
  }, [])

  // 前回選んだ一覧の並び順（個人設定）を使う。読み込む前に選び直していたら、そちらを優先する
  const sortChosen = useRef(false)
  useEffect(() => {
    window.api
      .getListSort()
      .then((saved) => {
        if (saved && !sortChosen.current) setSort(saved)
      })
      .catch((e) => console.error('[mokkan] 並び順の設定を読めませんでした', e))
  }, [])

  // 時間割で見ている日（null なら今日）
  const [timetableDate, setTimetableDate] = useState<string | null>(null)
  const showError = useCallback((message: string) => setError(message), [])

  // 画面ごとの編集画面の幅（個人設定）。境目をドラッグして変えたもの
  const [paneWidths, setPaneWidths] = useState<PaneWidths>({})
  useEffect(() => {
    window.api
      .getPaneWidths()
      .then((saved) => setPaneWidths((now) => ({ ...saved, ...now })))
      .catch((e) => console.error('[mokkan] 編集画面の幅の設定を読めませんでした', e))
  }, [])
  const resizeEditor = useCallback(
    (width: number | null) =>
      setPaneWidths((now) => {
        const next = { ...now }
        if (width === null) delete next[view]
        else next[view] = width
        return next
      }),
    [view]
  )
  const commitEditorWidth = useCallback(
    (width: number | null) => {
      resizeEditor(width)
      window.api
        .setPaneWidth(view, width)
        .catch((e) => console.error('[mokkan] 編集画面の幅を保存できませんでした', e))
    },
    [view, resizeEditor]
  )
  const editorWidth = paneWidths[view] ?? null

  // 自分の名前（個人設定）。担当者の絞り込みの「自分」に使う
  const [userName, setUserName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  /** 開いているヘルプのタブ。閉じていれば null */
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null)
  /** 初めての起動で、名前の設定の後に「はじめに」（AI の案内）を出すか */
  const startGuidePending = useRef(false)
  const showStartGuideIfPending = useCallback(() => {
    if (!startGuidePending.current) return
    startGuidePending.current = false
    setHelpTopic('start')
  }, [])
  useEffect(() => {
    window.api
      .getUserName()
      .then(setUserName)
      .catch((e) => console.error('[mokkan] 自分の名前の設定を読めませんでした', e))
  }, [])
  // 初めての起動とバージョンアップのときに、設定ボタンへ案内する。フォルダを選んだ後に1回だけ確かめる
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null)
  const onboardingChecked = useRef(false)
  const folderReady = state?.folderStatus === 'ready'
  useEffect(() => {
    if (!folderReady || onboardingChecked.current) return
    onboardingChecked.current = true
    window.api
      .getOnboarding()
      .then((result) => {
        // 初めての起動では、名前の設定（または帯を閉じた）後に「はじめに」を出す
        if (result === 'first') startGuidePending.current = true
        setOnboarding(result)
      })
      .catch((e) => console.error('[mokkan] 設定の案内を確かめられませんでした', e))
  }, [folderReady])
  /** 案内を閉じる（今の版を覚え、次からは出さない） */
  const dismissOnboarding = useCallback(() => {
    setOnboarding(null)
    window.api
      .dismissOnboarding()
      .catch((e) => console.error('[mokkan] 設定の案内を閉じられませんでした', e))
  }, [])
  /** 案内の帯の「閉じる」。初めての起動なら、続けて「はじめに」を出す */
  const closeOnboardingBanner = useCallback(() => {
    dismissOnboarding()
    showStartGuideIfPending()
  }, [dismissOnboarding, showStartGuideIfPending])
  const openSettings = useCallback(() => {
    setSettingsOpen(true)
    if (onboarding) dismissOnboarding()
  }, [onboarding, dismissOnboarding])
  const saveUserName = useCallback(async (name: string) => {
    setUserName(await window.api.setUserName(name))
  }, [])

  const changeSort = useCallback((next: ListSort) => {
    sortChosen.current = true
    setSort(next)
    window.api
      .setListSort(next)
      .catch((e) => console.error('[mokkan] 並び順の設定を保存できませんでした', e))
  }, [])

  /** 裏方の操作を呼び、失敗したら画面上部に理由を出す */
  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    }
  }, [])

  /** 「← 戻る」で戻る先（直前に開いていたチケットやノートのキー。新しいものが最後） */
  const [history, setHistory] = useState<string[]>([])
  const selectedRef = useRef<Selection | null>(null)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  /** 編集画面で開くものを切り替え、今開いているものを戻る先に積む */
  const select = useCallback((next: Selection) => {
    const cur = selectedRef.current
    if (cur?.fileName === next.fileName) return
    if (cur) {
      setHistory((h) =>
        [...h.filter((f) => f !== cur.fileName && f !== next.fileName), cur.fileName].slice(
          -MAX_HISTORY
        )
      )
    }
    selectedRef.current = next
    setSelected(next)
  }, [])

  /** ノートの画面の左の木で選んでいるフォルダ（空文字ならすべて）と、種類の絞り込み */
  const [noteFolder, setNoteFolder] = useState('')
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([])
  /** ノートの画面で、一覧の代わりに点検の結果を出しているか */
  const [lintOpen, setLintOpen] = useState(false)

  /** tasks/templates/ のテンプレートと、前回選んだもの（個人設定。null なら標準） */
  const [templates, setTemplates] = useState<TemplateList>({ tickets: [], notes: [] })
  const [choice, setChoice] = useState<Record<TemplateKind, string | null>>({
    ticket: null,
    note: null
  })
  const loadTemplates = useCallback(() => {
    window.api
      .listTemplates()
      .then((list) => {
        setTemplates(list)
        // 前回選んだテンプレートがなくなっていたら、標準に戻す
        setChoice((c) => ({
          ticket: c.ticket && list.tickets.includes(c.ticket) ? c.ticket : null,
          note: c.note && list.notes.includes(c.note) ? c.note : null
        }))
      })
      .catch((e) => console.error('[mokkan] テンプレートを読めませんでした', e))
  }, [])
  useEffect(() => {
    if (!folderReady) return
    Promise.all([window.api.getTemplateChoice('ticket'), window.api.getTemplateChoice('note')])
      .then(([ticket, note]) => setChoice({ ticket, note }))
      .then(loadTemplates)
      .catch((e) => console.error('[mokkan] テンプレートの設定を読めませんでした', e))
  }, [folderReady, loadTemplates])
  /** 選んだテンプレートを次からの既定にする */
  const rememberChoice = useCallback((kind: TemplateKind, name: string | null) => {
    setChoice((c) => ({ ...c, [kind]: name }))
    window.api
      .setTemplateChoice(kind, name)
      .catch((e) => console.error('[mokkan] テンプレートの設定を保存できませんでした', e))
  }, [])

  const createTicket = useCallback(
    (template: string | null) =>
      run(async () => {
        // 絞り込みでタグを1つだけ選んでいるときは、そのタグを初めの値にする
        const { fileName } = await window.api.createTicket(
          filter.tags.length === 1 ? filter.tags : [],
          template
        )
        select({ fileName, isNew: true })
      }),
    [run, select, filter.tags]
  )

  const createNote = useCallback(
    (template: string | null) =>
      run(async () => {
        // 左の木で選んでいるフォルダに作る（なくなっていたら notes/ の直下）
        const folder = state?.noteFolders.includes(noteFolder) ? noteFolder : ''
        const { fileName } = await window.api.createNote({ template, folder })
        select({ fileName, isNew: true })
      }),
    [run, select, noteFolder, state]
  )
  /** 「＋ 新規」と Ctrl+N で作るもの。ノートの画面ではノート、ほかの画面ではチケット */
  const newKind: TemplateKind = view === 'notes' ? 'note' : 'ticket'
  const createWith = useCallback(
    (template: string | null) => {
      if (template !== choice[newKind]) rememberChoice(newKind, template)
      return newKind === 'note' ? createNote(template) : createTicket(template)
    },
    [newKind, choice, rememberChoice, createNote, createTicket]
  )
  const createNew = useCallback(() => createWith(choice[newKind]), [createWith, choice, newKind])

  const createNoteFolder = useCallback(
    async (parent: string, name: string): Promise<string | null> => {
      try {
        setNoteFolder(await window.api.createNoteFolder(parent, name))
        return null
      } catch (e) {
        return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
    },
    []
  )

  /** アーカイブ・戻すでファイルを移したら、開いているチケットを移した先に切り替える */
  const applyMoved = useCallback((moved: Record<string, string>) => {
    setSelected((cur) =>
      cur && moved[cur.fileName] ? { fileName: moved[cur.fileName], isNew: false } : cur
    )
    setHistory((h) => h.map((f) => moved[f] ?? f))
  }, [])

  const archiveDoneBefore = useCallback(
    async (cutoff: string) => applyMoved(await window.api.archiveDoneBefore(cutoff)),
    [applyMoved]
  )

  const open = useCallback((fileName: string) => select({ fileName, isNew: false }), [select])

  /** 検索の結果から開いたときに、本文で探して選ぶ語 */
  const [jump, setJump] = useState<{ fileName: string; term: string; nonce: number } | null>(null)
  const openFromSearch = useCallback(
    (fileName: string, term: string) => {
      setJump({ fileName, term, nonce: Date.now() })
      select({ fileName, isNew: false })
    },
    [select]
  )

  const close = useCallback(() => {
    selectedRef.current = null
    setSelected(null)
    setHistory([])
  }, [])

  // 別のチケットに切り替えたり閉じたりしたら、前のチケットの保存を待ち、空の新規チケットなら片付ける
  const previous = useRef<Selection | null>(null)
  useEffect(() => {
    const prev = previous.current
    previous.current = selected
    if (prev && prev.fileName !== selected?.fileName) {
      void afterClose(prev.fileName, prev.isNew).catch((e) => setError((e as Error).message))
    }
  }, [selected])

  // 1操作で作れるよう、Ctrl+N（macは⌘N。Mac の ⌃N は次の行への移動なので受け取らない）で新規作成する
  const ready = state?.folderStatus === 'ready'
  useEffect(() => {
    if (!ready) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isModKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void createNew()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ready, createNew])

  const tickets = useMemo(() => state?.tickets ?? [], [state])
  const today = formatDate(new Date())
  const visible = useMemo(
    () => listTickets(tickets, filter, today, sort),
    [tickets, filter, today, sort]
  )
  const notes = useMemo(() => state?.notes ?? [], [state])
  const noteFolders = useMemo(() => state?.noteFolders ?? [], [state])
  // 選んでいたフォルダがなくなったら（外部で消した・名前を変えたなど）、すべてを出す
  const activeFolder = noteFolders.includes(noteFolder) ? noteFolder : ''
  // 木の件数は、フォルダのほかの絞り込み（タグ・種類）をかけたもので数える
  const notesForTree = useMemo(
    () =>
      view === 'notes' ? listNotes(notes, { tags: filter.tags, folder: '', types: noteTypes }) : [],
    [view, notes, filter.tags, noteTypes]
  )
  const visibleNotes = useMemo(
    () => listNotes(notesForTree, { tags: [], folder: activeFolder, types: [] }),
    [notesForTree, activeFolder]
  )
  // タグの絞り込みは全画面で共通なので、ノートのタグも選べるようにする
  const tags = useMemo(() => collectTags([...tickets, ...notes]), [tickets, notes])
  const assignees = useMemo(() => collectAssignees(tickets), [tickets])
  const events = useMemo(
    () => (view === 'calendar' ? calendarItems(tickets, filter, today) : []),
    [view, tickets, filter, today]
  )
  // ガントでキーの値ごとにまとめられるキー。ガントに出るのはチケットだけなので、ノートのタグは含めない
  const ganttKeys = useMemo(() => tagKeys(tickets.flatMap((t) => t.tags)), [tickets])
  // キーの値ごとにまとめていたキーのタグがなくなったら、タグごとに戻す
  const ganttGrouping = useMemo(() => {
    const key = groupingKey(grouping)
    return key !== null && !ganttKeys.includes(key) ? 'tag' : grouping
  }, [grouping, ganttKeys])
  const rows = useMemo(
    () => (view === 'gantt' ? ganttRows(tickets, filter, ganttGrouping, today) : []),
    [view, tickets, filter, ganttGrouping, today]
  )
  const tagColors = useMemo(() => state?.tagColors ?? {}, [state])
  const warnings = useMemo(() => {
    const list = findWarnings(tickets, notes)
    // TAGS.md（タグの色）は開いて直す画面がないので、ファイル名は文で出す
    const tagFile = state?.tagFile
    if (tagFile?.error) list.push({ kind: 'tags-file', message: tagFile.error, fileNames: [] })
    if (tagFile && tagFile.conflicts.length > 0) {
      list.push({
        kind: 'tags-file',
        message: `タグの色のファイルの競合コピーがあります（${tagFile.conflicts.join('・')}）。中身を TAGS.md にまとめてから消してください`,
        fileNames: []
      })
    }
    return list
  }, [tickets, notes, state])

  // 戻る先。なくなったファイル（空のまま閉じて削除した新規など）は飛ばす
  const titleOfKey = useMemo(
    () => new Map([...tickets, ...notes].map((f) => [f.fileName, f.title] as const)),
    [tickets, notes]
  )
  const backTarget =
    [...history].reverse().find((f) => titleOfKey.has(f) && f !== selected?.fileName) ?? null
  const goBack = useCallback(() => {
    if (!backTarget) return
    setHistory((h) => h.slice(0, h.lastIndexOf(backTarget)))
    selectedRef.current = { fileName: backTarget, isNew: false }
    setSelected({ fileName: backTarget, isNew: false })
  }, [backTarget])

  // Alt+←（Mac は ⌘[）とマウスの「戻る」ボタンでも戻る
  useEffect(() => {
    if (!backTarget) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isBackKey(e)) {
        e.preventDefault()
        goBack()
      }
    }
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        goBack()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [backTarget, goBack])
  const titles = useMemo(
    () => new Map(tickets.flatMap((t) => (t.id ? [[t.id, t.title] as const] : []))),
    [tickets]
  )

  if (!state) return <div className="loading">読み込み中…</div>

  return (
    <div className="app">
      <header className="header">
        <h1 className="brand">mokkan</h1>
        {ready && (
          <nav className="views">
            {VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v]
              return (
                <button
                  key={v}
                  className={view === v ? 'view with-icon shrink-4 on' : 'view with-icon shrink-4'}
                  onClick={() => setView(v)}
                  title={VIEW_LABELS[v]}
                  aria-label={VIEW_LABELS[v]}
                >
                  <Icon className="icon" aria-hidden="true" />
                  <span className="btn-label">{VIEW_LABELS[v]}</span>
                </button>
              )
            })}
          </nav>
        )}
        {ready && <SearchBox onOpen={openFromSearch} />}
        <div className="folder" title={state.tasksDir ?? ''}>
          <span className="folder-path">{state.tasksDir ?? 'フォルダ未設定'}</span>
        </div>
        {state.tasksDir && (
          <button
            className="ghost with-icon shrink-2"
            onClick={() => run(() => window.api.revealFolder())}
            title={`フォルダを開く：${state.tasksDir}`}
            aria-label="フォルダを開く"
          >
            <FolderOpen className="icon" aria-hidden="true" />
            <span className="btn-label">フォルダを開く</span>
          </button>
        )}
        <button
          className="ghost with-icon shrink-2"
          onClick={() => run(() => window.api.chooseFolder())}
          title="フォルダを変える"
          aria-label="フォルダを変える"
        >
          <FolderInput className="icon" aria-hidden="true" />
          <span className="btn-label">フォルダを変える</span>
        </button>
        <button
          className={onboarding ? 'ghost with-icon shrink-3 has-dot' : 'ghost with-icon shrink-3'}
          onClick={openSettings}
          title={onboarding ? '設定（確かめてほしいことがあります）' : '設定'}
          aria-label="設定"
        >
          <Settings className="icon" aria-hidden="true" />
          <span className="btn-label">設定</span>
        </button>
        <button
          className="ghost with-icon help-button"
          onClick={() => setHelpTopic(view)}
          title="ヘルプ：この画面でできることと、手元の AI に頼めること"
          aria-label="ヘルプ"
        >
          <CircleHelp className="icon" aria-hidden="true" />
        </button>
        <NewButton
          label={view === 'notes' ? '新規ノート' : '新規'}
          disabled={!ready}
          choice={choice[newKind]}
          templates={newKind === 'note' ? templates.notes : templates.tickets}
          onOpenMenu={loadTemplates}
          onCreate={(template) => void createWith(template)}
        />
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
          <button className="ghost" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}

      {ready && onboarding && (
        <div className="banner" role="status">
          <span>
            {onboarding === 'first'
              ? 'はじめに、設定で自分の名前を入れてください（新しいチケットの作成者や、担当者の絞り込みの「自分」に使います）。'
              : 'ルールのファイルが新しくなりました。設定で更新できます（更新しないと、AI が古い決まりで動きます）。'}
          </span>
          <span className="actions">
            <button className="primary" onClick={openSettings}>
              設定を開く
            </button>
            <button className="ghost" onClick={closeOnboardingBanner}>
              閉じる
            </button>
          </span>
        </div>
      )}

      {ready && state.renamedOnStart > 0 && renameNoticeClosedFor !== state.tasksDir && (
        <div className="banner" role="status">
          <span>
            {state.renamedOnStart} 件のファイル名に見出しを付けました（ID だけの名前だったもの）。
          </span>
          <button className="ghost" onClick={() => setRenameNoticeClosedFor(state.tasksDir)}>
            閉じる
          </button>
        </div>
      )}

      {ready ? (
        <div
          className={[
            'panes',
            `view-${view}`,
            selected ? 'with-editor' : '',
            editorWidth !== null ? 'custom-width' : ''
          ].join(' ')}
          style={
            editorWidth !== null
              ? ({ '--editor-width': `${editorWidth}px` } as React.CSSProperties)
              : undefined
          }
        >
          {view === 'notes' && (
            <NoteFolderTree
              folders={noteFolders}
              notes={notesForTree}
              selected={activeFolder}
              onSelect={setNoteFolder}
              types={noteTypes}
              onTypesChange={setNoteTypes}
              onCreateFolder={createNoteFolder}
            />
          )}
          <main className="main">
            <WarningList warnings={warnings} onOpen={open} />
            {/* 点検はすべてのノートを見るので、絞り込みは出さない。時間割はその日の予定なので出さない */}
            {!(view === 'notes' && lintOpen) && view !== 'timetable' && (
              <FilterBar
                filter={filter}
                tags={tags}
                assignees={assignees}
                userName={userName}
                showFutureStartOption={view === 'list'}
                sort={view === 'list' ? sort : undefined}
                onSortChange={changeSort}
                onChange={setFilter}
                tagsOnly={view === 'notes'}
                tagColors={tagColors}
                actions={
                  view === 'notes' && (
                    <button
                      className="ghost"
                      onClick={() => setLintOpen(true)}
                      title="切れたリンク・見直していない知識・入口から外れた知識などを探します"
                    >
                      点検…
                    </button>
                  )
                }
              />
            )}
            {view === 'list' && (
              <>
                <TicketList
                  tickets={visible}
                  today={today}
                  titles={titles}
                  selected={selected?.fileName ?? null}
                  tagColors={tagColors}
                  onOpen={open}
                />
                <footer className="footer">
                  <span>
                    {visible.length} 件を表示中（未完了{' '}
                    {tickets.filter((t) => t.status !== 'done').length} 件 / 全{' '}
                    {tickets.filter((t) => !t.archived).length} 件
                    {tickets.some((t) => t.archived) &&
                      ` / アーカイブ ${tickets.filter((t) => t.archived).length} 件`}
                    ）
                  </span>
                  <button className="ghost" onClick={() => setArchiveOpen(true)}>
                    まとめてアーカイブ…
                  </button>
                </footer>
              </>
            )}
            {view === 'notes' && lintOpen && (
              <NoteLintPanel
                stamp={state}
                onOpen={open}
                onSelectFolder={(folder) => {
                  setNoteFolder(folder)
                  setLintOpen(false)
                }}
                onClose={() => setLintOpen(false)}
              />
            )}
            {view === 'notes' && !lintOpen && (
              <>
                <NoteList
                  notes={visibleNotes}
                  tickets={tickets}
                  folder={activeFolder}
                  selected={selected?.fileName ?? null}
                  tagColors={tagColors}
                  onOpen={open}
                />
                <footer className="footer">
                  <span>
                    {visibleNotes.length} 件を表示中（全 {notes.length} 件）
                  </span>
                </footer>
              </>
            )}
            {view === 'calendar' && (
              <CalendarView
                items={events}
                selected={selected?.fileName ?? null}
                tagColors={tagColors}
                tags={tags}
                onOpen={open}
              />
            )}
            {view === 'timetable' && (
              <TimetableView
                date={timetableDate ?? today}
                today={today}
                onDateChange={(date) => setTimetableDate(date === today ? null : date)}
                tickets={tickets}
                notes={notes}
                noteFolders={noteFolders}
                days={state.days}
                selected={selected?.fileName ?? null}
                onOpen={open}
                onError={showError}
              />
            )}
            {view === 'gantt' && (
              <GanttView
                rows={rows}
                grouping={ganttGrouping}
                groupKeys={ganttKeys}
                today={today}
                selected={selected?.fileName ?? null}
                compact={selected !== null}
                tagColors={tagColors}
                tags={tags}
                onGroupingChange={setGrouping}
                onOpen={open}
              />
            )}
          </main>
          {selected && (
            <PaneSplitter
              width={editorWidth}
              onResize={resizeEditor}
              onCommit={commitEditorWidth}
            />
          )}
          {selected && (
            <TicketEditor
              key={selected.fileName}
              fileName={selected.fileName}
              isNew={selected.isNew}
              tickets={tickets}
              notes={notes}
              noteFolders={noteFolders}
              tagColors={tagColors}
              onOpen={open}
              onShowTag={(tag) => {
                // 入口のノートの「一覧で見る」：そのプロジェクトのタグの未完了のチケットを一覧に出す
                // 入口に出したもの（projectOpenTickets）と同じになるよう、ほかの絞り込みは外し、着手日が先のものも出す
                setFilter({ ...DEFAULT_FILTER, tags: [tag], showFutureStart: true })
                setView('list')
              }}
              onBack={backTarget ? goBack : undefined}
              backLabel={backTarget ? titleOfKey.get(backTarget) || '（タイトルなし）' : undefined}
              onClose={close}
              onMoved={applyMoved}
              jump={jump?.fileName === selected.fileName ? jump : undefined}
            />
          )}
        </div>
      ) : (
        <FolderSetup
          state={state}
          onChoose={() => run(() => window.api.chooseFolder())}
          onInit={() => run(() => window.api.initFolder())}
        />
      )}

      {archiveOpen && (
        <ArchiveDialog
          tickets={tickets}
          today={today}
          onArchive={archiveDoneBefore}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {helpTopic && (
        <HelpDialog
          initial={helpTopic}
          tasksDir={state.tasksDir}
          onClose={() => setHelpTopic(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          userName={userName}
          folderReady={ready}
          onSave={saveUserName}
          onClose={() => {
            setSettingsOpen(false)
            showStartGuideIfPending()
          }}
        />
      )}
    </div>
  )
}

export default App
