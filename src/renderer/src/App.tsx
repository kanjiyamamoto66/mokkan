import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Onboarding } from '../../shared/api'
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
import { listNotes } from '../../shared/note'
import { calendarItems, ganttRows, type GanttGrouping } from '../../shared/schedule'
import CalendarView from './components/CalendarView'
import FilterBar from './components/FilterBar'
import GanttView from './components/GanttView'
import FolderSetup from './components/FolderSetup'
import SearchBox from './components/SearchBox'
import SettingsDialog from './components/SettingsDialog'
import ArchiveDialog from './components/ArchiveDialog'
import TicketEditor from './components/TicketEditor'
import { afterClose } from './editor/closing'
import NoteList from './components/NoteList'
import TicketList from './components/TicketList'
import WarningList from './components/WarningList'

type View = 'list' | 'calendar' | 'gantt' | 'notes'

/** 「← 戻る」で覚えておく数 */
const MAX_HISTORY = 50

const VIEWS: readonly View[] = ['list', 'calendar', 'gantt', 'notes']
const VIEW_LABELS: Record<View, string> = {
  list: '一覧',
  calendar: 'カレンダー',
  gantt: 'ガント',
  notes: 'ノート'
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

  // 自分の名前（個人設定）。担当者の絞り込みの「自分」に使う
  const [userName, setUserName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
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
      .then(setOnboarding)
      .catch((e) => console.error('[mokkan] 設定の案内を確かめられませんでした', e))
  }, [folderReady])
  /** 案内を閉じる（今の版を覚え、次からは出さない） */
  const dismissOnboarding = useCallback(() => {
    setOnboarding(null)
    window.api
      .dismissOnboarding()
      .catch((e) => console.error('[mokkan] 設定の案内を閉じられませんでした', e))
  }, [])
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

  const createTicket = useCallback(
    () =>
      run(async () => {
        // 絞り込みでタグを1つだけ選んでいるときは、そのタグを初めの値にする
        const { fileName } = await window.api.createTicket(
          filter.tags.length === 1 ? filter.tags : []
        )
        select({ fileName, isNew: true })
      }),
    [run, select, filter.tags]
  )

  const createNote = useCallback(
    () =>
      run(async () => {
        const { fileName } = await window.api.createNote()
        select({ fileName, isNew: true })
      }),
    [run, select]
  )
  /** 「＋ 新規」と Ctrl+N で作るもの。ノートの画面ではノート、ほかの画面ではチケット */
  const createNew = view === 'notes' ? createNote : createTicket

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

  // 1操作で作れるよう、Ctrl+N（macは⌘N）で新規作成する
  const ready = state?.folderStatus === 'ready'
  useEffect(() => {
    if (!ready) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
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
  const visibleNotes = useMemo(
    () => (view === 'notes' ? listNotes(notes, filter.tags) : []),
    [view, notes, filter.tags]
  )
  // タグの絞り込みは全画面で共通なので、ノートのタグも選べるようにする
  const tags = useMemo(() => collectTags([...tickets, ...notes]), [tickets, notes])
  const assignees = useMemo(() => collectAssignees(tickets), [tickets])
  const events = useMemo(
    () => (view === 'calendar' ? calendarItems(tickets, filter, today) : []),
    [view, tickets, filter, today]
  )
  const rows = useMemo(
    () => (view === 'gantt' ? ganttRows(tickets, filter, grouping, today) : []),
    [view, tickets, filter, grouping, today]
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

  // Alt+← とマウスの「戻る」ボタンでも戻る
  useEffect(() => {
    if (!backTarget) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowLeft') {
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
            {VIEWS.map((v) => (
              <button
                key={v}
                className={view === v ? 'view on' : 'view'}
                onClick={() => setView(v)}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </nav>
        )}
        {ready && <SearchBox onOpen={openFromSearch} />}
        <div className="folder" title={state.tasksDir ?? ''}>
          {state.tasksDir ?? 'フォルダ未設定'}
        </div>
        {state.tasksDir && (
          <button className="ghost" onClick={() => run(() => window.api.revealFolder())}>
            フォルダを開く
          </button>
        )}
        <button className="ghost" onClick={() => run(() => window.api.chooseFolder())}>
          フォルダを変える
        </button>
        <button
          className={onboarding ? 'ghost has-dot' : 'ghost'}
          onClick={openSettings}
          title={onboarding ? '設定で確かめてほしいことがあります' : undefined}
        >
          設定
        </button>
        <button className="primary" disabled={!ready} onClick={createNew}>
          {view === 'notes' ? '＋ 新規ノート' : '＋ 新規'} <kbd>Ctrl+N</kbd>
        </button>
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
            <button className="ghost" onClick={dismissOnboarding}>
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
        <div className={['panes', `view-${view}`, selected ? 'with-editor' : ''].join(' ')}>
          <main className="main">
            <WarningList warnings={warnings} onOpen={open} />
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
            />
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
            {view === 'notes' && (
              <>
                <NoteList
                  notes={visibleNotes}
                  tickets={tickets}
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
            {view === 'gantt' && (
              <GanttView
                rows={rows}
                grouping={grouping}
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
            <TicketEditor
              key={selected.fileName}
              fileName={selected.fileName}
              isNew={selected.isNew}
              tickets={tickets}
              notes={notes}
              tagColors={tagColors}
              onOpen={open}
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

      {settingsOpen && (
        <SettingsDialog
          userName={userName}
          folderReady={ready}
          onSave={saveUserName}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

export default App
