// ガントチャート（SVAR React Gantt の MIT 版。PRO 版の機能は使わない）
//
// MIT 版にない機能は、アプリ側で補う
// - まとめ棒の期間：子孫全体の期間をアプリが計算して渡す（ganttRows）
// - タグごとのまとめ：アプリがタグの見出し行を作って渡す
// - 日付のない行：仮の日付を入れ、その行の棒だけを CSS で隠す
// 名前の列は自前で描く（字下げは4段まで、深い階層は経路を表示、警告の印、祖先を薄く）

import { Gantt, Willow, WillowDark, type IApi, type ITask } from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/all.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, type GanttGrouping, type GanttRow } from '../../../shared/schedule'
import { tagHue, type TagColors } from '../../../shared/tagColor'
import { formatDate, type Status } from '../../../shared/ticket'
import { tagStyle } from '../tagStyle'
import { PRIORITY_LABELS, STATUS_LABELS } from '../labels'
import { useDarkMode } from '../useDarkMode'
import Legend from './Legend'

interface Props {
  rows: GanttRow[]
  grouping: GanttGrouping
  today: string
  selected: string | null
  /** 編集画面を横に開いていて幅が狭いとき。グリッドを細くして期間の列を隠す */
  compact: boolean
  /** タグの色（TAGS.md）。選んでいないタグは名前から決める */
  tagColors: TagColors
  /** 凡例に出すタグ */
  tags: string[]
  onGroupingChange: (grouping: GanttGrouping) => void
  onOpen: (fileName: string) => void
}

/** SVAR は幅がこれ以下だと、グリッドか棒のどちらか一方だけを表示する */
const SVAR_COMPACT_WIDTH = 650

/** 名前の列で字下げする最大の段数 */
const MAX_INDENT = 4
const INDENT_PX = 14

/** 状態ごとの棒の塗り方（カレンダーの予定と同じ。色は main.css の --status-*） */
const BAR_STATUS_STYLES: Record<Status, string> = {
  todo: '--bar-bg:var(--surface);--bar-border:var(--status-todo);--bar-border-width:2px;--bar-fg:var(--text)',
  doing:
    '--bar-bg:var(--status-doing);--bar-border:var(--status-doing);--bar-fg:var(--status-doing-text)',
  waiting:
    '--bar-bg:var(--status-waiting-fill);--bar-border:var(--status-waiting);--bar-fg:var(--text)',
  done: '--bar-bg:var(--status-done);--bar-border:var(--status-done);--bar-fg:var(--status-done-text);--bar-decoration:line-through'
}

/** 状態がない（読めない）チケットは未着手と同じ塗り方にする */
function barStatusStyle(status: Status | null): string {
  return BAR_STATUS_STYLES[status ?? 'todo']
}

/** 選択中の枠。アクセント色（青）は状態の塗りと見分けにくいので、文字の色にする */
const SELECTED_BAR_STYLE = 'outline:2px solid var(--selected-ring);outline-offset:1px'

/** `YYYY-MM-DD` を現地時刻のその日の 0 時にする */
function localDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function GanttView({
  rows,
  grouping,
  today,
  selected,
  compact,
  tagColors,
  tags,
  onGroupingChange,
  onOpen
}: Props): React.JSX.Element {
  const dark = useDarkMode()
  const apiRef = useRef<IApi | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // 幅が狭くて一方しか出せないときは、日程（棒）のほうを出す
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width <= SVAR_COMPACT_WIDTH)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  /** ユーザーが開閉した行（ファイルが変わって行を作り直しても開閉を保つ） */
  const [openState, setOpenState] = useState<Map<string, boolean>>(new Map())
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])

  const tasks = useMemo<ITask[]>(
    () =>
      rows.map((r) => {
        const start = localDate(r.start ?? today)
        const base: ITask = {
          id: r.key,
          text: r.title || '（タイトルなし）',
          parent: r.parentKey ?? 0,
          open: r.hasChildren ? (openState.get(r.key) ?? r.open) : undefined,
          start
        }
        if (r.kind === 'milestone') return { ...base, type: 'milestone' }
        // 終わりの日は含まないので、最後の日の翌日を渡す
        const end = localDate(addDays(r.end ?? today, 1))
        const type = r.kind === 'summary' || r.kind === 'group' ? 'summary' : 'task'
        return { ...base, type, end }
      }),
    [rows, today, openState]
  )

  // 表示する範囲：一番早い日の1週間前から、一番遅い日の2週間後まで（今日は必ず含める）
  const range = useMemo(() => {
    let min = today
    let max = today
    for (const r of rows) {
      if (r.start && r.start < min) min = r.start
      if (r.end && r.end > max) max = r.end
    }
    return { start: localDate(addDays(min, -7)), end: localDate(addDays(max, 14)) }
  }, [rows, today])

  // 棒の塗り方（状態）・期限切れの枠・選択中の枠を付け、日付のない行の棒は隠し、文脈として出す祖先の棒は薄くする
  // SVAR の棒には印を付けられないので、行ごとの CSS を作る。塗りの中身は main.css の --bar-* で決める
  const barStyles = useMemo(() => {
    // SVAR は文字列の id の前に「:」を付けて data-id に入れる
    const selector = (keys: string[]): string =>
      `.mk-gantt .wx-bar:is(${keys.map((k) => `[data-id=${JSON.stringify(':' + k)}]`).join(',')})`
    const groups = new Map<string, string[]>()
    const add = (body: string, key: string): void => {
      groups.set(body, [...(groups.get(body) ?? []), key])
    }
    for (const r of rows) {
      if (r.kind === 'nodate') add('display:none', r.key)
      if (r.fileName) add(barStatusStyle(r.status), r.key)
      // タグごとの見出しのまとめ棒は、そのタグの色にする（チケットの棒の塗りは状態のまま）
      if (!r.fileName && r.tag)
        add(`--tag-h:${tagHue(r.tag, tagColors)};--bar-bg:var(--tag-bar)`, r.key)
      if (r.overdue) add('--bar-ring:var(--danger)', r.key)
      if (r.faded) add('opacity:0.35', r.key)
      if (r.fileName && r.fileName === selected) add(SELECTED_BAR_STYLE, r.key)
    }
    return [...groups].map(([body, keys]) => `${selector(keys)}{${body}}`).join('\n')
  }, [rows, selected, tagColors])

  const toggle = useCallback((key: string, open: boolean) => {
    setOpenState((prev) => new Map(prev).set(key, open))
    apiRef.current?.exec('open-task', { id: key, mode: open })
  }, [])

  const NameCell = useCallback(
    ({ row }: { row: ITask }): React.JSX.Element | null => {
      const r = byKey.get(String(row.id))
      if (!r) return null
      const open = Boolean(row.open)
      // 4段より深い階層は字下げを止める。マウスを乗せると「親 > 子 > 孫」の経路を表示する
      const path = r.path.length > 0 ? [...r.path, r.title || '（タイトルなし）'].join(' > ') : ''
      return (
        <div
          className={[
            'mk-name',
            r.faded ? 'faded' : '',
            r.fileName ? '' : 'group',
            // 完了は灰色＋取り消し線（棒と同じ）。条件に合わない祖先（faded）は薄くするだけなので見分けられる
            r.fileName && r.status === 'done' ? 'done' : '',
            r.tag ? 'tag-colored' : ''
          ].join(' ')}
          style={{
            paddingLeft: Math.min(r.depth, MAX_INDENT) * INDENT_PX,
            // 左端の線は最初のタグの色（タグごとの見出しはそのタグの色）
            ...(r.tag ? tagStyle(r.tag, tagColors) : {})
          }}
          title={path || undefined}
        >
          {r.hasChildren ? (
            <button
              className="mk-toggle"
              aria-label={open ? '閉じる' : '開く'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                toggle(r.key, !open)
              }}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="mk-toggle-space" />
          )}
          {r.fileName && (
            <span
              className={`priority-dot p${r.priority}`}
              title={`優先度 ${PRIORITY_LABELS[r.priority]}`}
            />
          )}
          {r.overdue && (
            <span className="overdue-mark" title="期限切れ">
              !
            </span>
          )}
          <span className={r.title ? 'mk-title' : 'mk-title untitled'}>
            {r.title || '（タイトルなし）'}
          </span>
          {r.status && r.fileName && r.status !== 'todo' && (
            <span className={`mk-status ${r.status}`}>{STATUS_LABELS[r.status]}</span>
          )}
          {r.warning && (
            <span className="mk-warning" title={r.warning}>
              ⚠
            </span>
          )}
        </div>
      )
    },
    [byKey, toggle, tagColors]
  )

  const SpanCell = useCallback(
    ({ row }: { row: ITask }): React.JSX.Element | null => {
      const r = byKey.get(String(row.id))
      if (!r || !r.start) return null
      const short = (d: string): string => d.slice(5).replace('-', '/')
      return (
        <span className="mk-span">
          {r.start === r.end ? short(r.start) : `${short(r.start)}〜${short(r.end!)}`}
        </span>
      )
    },
    [byKey]
  )

  const columns = useMemo(
    () => [
      // id を text にすると SVAR が木の列として独自の字下げと開閉ボタンを付けるので、別の id にする
      { id: 'name', header: 'チケット', flexgrow: 1, cell: NameCell },
      ...(compact ? [] : [{ id: 'span', header: '期間', width: 96, cell: SpanCell }])
    ],
    [NameCell, SpanCell, compact]
  )

  const scales = useMemo(
    () => [
      {
        unit: 'month' as const,
        step: 1,
        format: (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`
      },
      { unit: 'day' as const, step: 1, format: (d: Date) => String(d.getDate()) }
    ],
    []
  )

  const selectedKeys = useMemo(
    () => rows.filter((r) => r.fileName && r.fileName === selected).map((r) => r.key),
    [rows, selected]
  )

  const Theme = dark ? WillowDark : Willow

  return (
    <div className="gantt-view">
      <div className="gantt-toolbar">
        <span className="label">まとめ方</span>
        {(['parent', 'tag'] as const).map((g) => (
          <button
            key={g}
            className={grouping === g ? 'chip on' : 'chip'}
            onClick={() => onGroupingChange(g)}
          >
            {g === 'parent' ? '親チケットごと' : 'タグごと'}
          </button>
        ))}
        <Legend tags={tags} tagColors={tagColors} />
      </div>
      <style>{barStyles}</style>
      <div className="mk-gantt" ref={containerRef}>
        <Theme fonts={false}>
          <Gantt
            init={(api) => {
              apiRef.current = api
              api.on('open-task', (ev: { id: string | number; mode: boolean }) => {
                setOpenState((prev) => new Map(prev).set(String(ev.id), ev.mode))
              })
            }}
            tasks={tasks}
            links={[]}
            columns={columns}
            scales={scales}
            start={range.start}
            end={range.end}
            displayMode={narrow ? 'chart' : 'all'}
            gridWidth={compact ? 220 : 380}
            cellWidth={28}
            cellHeight={34}
            readonly
            selected={selectedKeys}
            highlightTime={(date, unit) => {
              if (unit !== 'day') return ''
              if (formatDate(date) === today) return 'mk-today'
              return date.getDay() === 0 || date.getDay() === 6 ? 'wx-weekend' : ''
            }}
            onSelectTask={(ev: { id: string | number }) => {
              const r = byKey.get(String(ev.id))
              if (r?.fileName) onOpen(r.fileName)
            }}
          />
        </Theme>
      </div>
    </div>
  )
}

export default GanttView
