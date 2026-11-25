// 時間割（その日一日の、何時から何時に何をするか）。tasks/days/YYYY-MM-DD.md の予定の行を読み書きする
// - 左にその日の候補のチケットを並べ、時間の欄へドラッグして置く
// - 予定はドラッグで動かし、下の端で長さを変える（15分刻み）。空いている時間をダブルクリックして予定を足す
// - 書き換えは裏方に「どの行をどう変えるか」を渡す（updateDay）。ファイルのほかの行は変えない

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../../../shared/note'
import type { TemplateList } from '../../../shared/api'
import {
  DEFAULT_TICKET_MINUTES,
  MINUTES_PER_DAY,
  busyMinutes,
  dayCandidates,
  otherTickets,
  durationLabel,
  entryLine,
  formatTime,
  isValidDate,
  layoutColumns,
  missingRoutine,
  parseDay,
  parseRoutine,
  routineFor,
  routineWorkHours,
  DEFAULT_WORK_HOURS,
  type DayEdit,
  type DayEntry
} from '../../../shared/day'
import { idFromHref, markdownLinkDestination, tasksPathOf } from '../../../shared/links'
import { addDays } from '../../../shared/schedule'
import type { Ticket } from '../../../shared/ticket'
import { WEEKDAY_LABELS } from '../../../shared/repeat'
import { STATUS_LABELS } from '../labels'

interface Props {
  date: string
  today: string
  onDateChange: (date: string) => void
  tickets: Ticket[]
  notes: Note[]
  noteFolders: string[]
  /** days/ のファイルと更新日時（変わったら読み直す） */
  days: Record<string, number>
  selected: string | null
  onOpen: (fileName: string) => void
  onError: (message: string) => void
}

/** 1時間の高さ（px） */
const HOUR_PX = 48
const PX_PER_MIN = HOUR_PX / 60
/** ドラッグで合わせる刻み（分） */
const SNAP = 15
/** 「ほかのチケットを置く」で出す数の上限 */
const MAX_OTHERS = 10
/** 「この日は外す」を覚えておくときのキー */
const skipKey = (date: string, content: string): string => `${date}\n${content}`
/** 日付の欄で移れる、いちばん前の日（年を打ち込んでいる途中の 0002-… などで移らないように） */
const MIN_JUMP_DATE = '1900-01-01'
/** ダブルクリックで足す予定の長さ（分） */
const DEFAULT_EVENT_MINUTES = 60
/** ドラッグで渡すチケットの種類 */
const TICKET_MIME = 'application/x-mokkan-ticket'

/** 予定の高さの下限（px）。15分（12px）では文字が1行も入らないので、1行分は取る */
const MIN_ENTRY_PX = 20
/** これより短い予定は、時刻と内容を1行に並べ、入りきらない内容は「…」で省く */
const SHORT_MINUTES = 45

function entryHeight(start: number, end: number): number {
  return Math.max((end - start) * PX_PER_MIN, MIN_ENTRY_PX)
}

function isShort(start: number, end: number): boolean {
  return end - start < SHORT_MINUTES
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP) * SNAP
}

function clampStart(start: number, length: number): number {
  return Math.min(Math.max(start, 0), MINUTES_PER_DAY - length)
}

function errorText(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 日付の見出し（2026年11月24日（火）） */
function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${y}年${m}月${d}日（${weekday}）`
}

/** md のリンクの文字に使えるようにする（`[` `]` は外す） */
function linkLabel(title: string): string {
  return title.replace(/[[\]]/g, '').trim() || '（タイトルなし）'
}

/** チケット・ノートへの、days/ から見たリンク */
function linkTo(key: string, title: string): string {
  return `[${linkLabel(title)}](${markdownLinkDestination(`../${tasksPathOf(key)}`)})`
}

/** 候補のチケットの一覧。時間の欄へドラッグして置く・クリックで開く */
function CandidateList({
  tickets,
  date,
  selected,
  onOpen
}: {
  tickets: Ticket[]
  date: string
  selected: string | null
  onOpen: (fileName: string) => void
}): React.JSX.Element | null {
  if (tickets.length === 0) return null
  return (
    <ul>
      {tickets.map((t) => (
        <li
          key={t.fileName}
          draggable
          className={t.fileName === selected ? 'selected' : undefined}
          onDragStart={(e) => {
            e.dataTransfer.setData(TICKET_MIME, t.fileName)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onOpen(t.fileName)}
          title="ドラッグして時間の欄に置く・クリックで開く"
        >
          <span className="timetable-candidate-title">{t.title || '（タイトルなし）'}</span>
          <small>
            {t.estimate !== null ? durationLabel(t.estimate) : '所要時間なし'}
            {t.due && ` ／ 期限 ${t.due}`}
            {t.due && t.due < date && ' ⚠'}
            {t.status === 'doing' && ` ／ ${STATUS_LABELS.doing}`}
          </small>
        </li>
      ))}
    </ul>
  )
}

/** 予定がリンクしているチケットかノート */
type Target = { kind: 'ticket'; ticket: Ticket } | { kind: 'note'; note: Note } | null

/** 動かしている・長さを変えている途中の予定 */
interface Drag {
  entry: DayEntry
  mode: 'move' | 'resize'
  startY: number
  start: number
  end: number
  moved: boolean
}

function TimetableView({
  date,
  today,
  onDateChange,
  tickets,
  notes,
  noteFolders,
  days,
  selected,
  onOpen,
  onError
}: Props): React.JSX.Element {
  /** 画面が最後に読んだ日のファイルの中身（なければ null）。書き換えのときに、変わっていないかを確かめる */
  const [text, setTextState] = useState<string | null>(null)
  // 書き換えを続けて行うときは、前の書き換えの結果を base にしたいので、最新の中身を ref にも持つ。
  // 書き込みの途中で日を移ることがあるので、どの日の中身かも一緒に持つ
  const textRef = useRef<{ date: string; text: string | null } | null>(null)
  const dateRef = useRef(date)
  useLayoutEffect(() => {
    dateRef.current = date
  }, [date])
  /** 読んだ・書いた日の中身を出す。今は別の日を見ていれば（日を移った後に届いた結果なら）捨てる */
  const setText = useCallback((forDate: string, next: string | null) => {
    if (forDate !== dateRef.current) return
    textRef.current = { date: forDate, text: next }
    setTextState(next)
  }, [])
  /** この画面で「この日は外す」を押したいつもの予定（日付と内容）。直後に「時間割にないもの」に出さない */
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [routineText, setRoutineText] = useState<string | null>(null)
  // 作業する時間は routine.md の frontmatter（work）にある。AI や設定の画面が書き換えたら、読み直しで変わる
  const workHours = useMemo(
    () => routineWorkHours(routineText) ?? DEFAULT_WORK_HOURS,
    [routineText]
  )
  const [loaded, setLoaded] = useState(false)
  /** 書き込みの途中の数（ドラッグは、書き込みが終わるまで始めない） */
  const [pending, setPending] = useState(0)
  const busy = pending > 0
  /** 書き換えを1件ずつ順に行うための待ち行列 */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  /** 今の時刻（0時からの分）。今の時刻の線を動かすため、1分ごとに読み直す */
  const [nowMin, setNowMin] = useState(() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  })
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date()
      setNowMin(now.getHours() * 60 + now.getMinutes())
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  /** 候補のほかのチケットを探す文字 */
  const [query, setQuery] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  /** ダブルクリックで足そうとしている予定の始まり */
  const [adding, setAdding] = useState<number | null>(null)
  /** 内容を書き換えている予定の行 */
  const [editing, setEditing] = useState<number | null>(null)
  /** 議事メモを作ろうとしている予定 */
  const [meeting, setMeeting] = useState<DayEntry | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const modified = days[date] ?? null
  const routineModified = days.routine ?? null
  // 日を変えたとき・外でファイルが変わったときに読み直す
  useEffect(() => {
    let alive = true
    window.api
      .readDay(date)
      .then((result) => {
        if (!alive) return
        setText(date, result.text)
        setRoutineText(result.routine)
        setLoaded(true)
      })
      .catch((e) => onError(`時間割を読めませんでした：${errorText(e)}`))
    return () => {
      alive = false
    }
  }, [date, modified, routineModified, onError, setText])

  // 開いたときと日を変えたときは、今の時刻（今日以外は作業する時間の始まり）のあたりを出す
  useEffect(() => {
    const now = new Date()
    const focus = date === today ? now.getHours() * 60 + now.getMinutes() : workHours.start
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (focus - 90) * PX_PER_MIN)
  }, [date, today, workHours.start])

  const content = useMemo(() => (text === null ? null : parseDay(text)), [text])
  /** ファイルがまだない今日と先の日は、写す予定のいつもの予定を薄く出す */
  const preview = useMemo(
    () =>
      text === null && date >= today && routineText
        ? routineFor(parseRoutine(routineText), date)
        : [],
    [text, date, today, routineText]
  )

  const byId = useMemo(() => {
    const map = new Map<string, Target>()
    for (const t of tickets) if (t.id) map.set(t.id, { kind: 'ticket', ticket: t })
    for (const n of notes) if (n.id) map.set(n.id, { kind: 'note', note: n })
    return map
  }, [tickets, notes])
  /** tasks/ からのパス（`tickets/x.md` など）→ チケット・ノート */
  const byPath = useMemo(() => {
    const map = new Map<string, Target>()
    for (const t of tickets) map.set(tasksPathOf(t.fileName), { kind: 'ticket', ticket: t })
    for (const n of notes) map.set(tasksPathOf(n.fileName), { kind: 'note', note: n })
    return map
  }, [tickets, notes])
  // リンク先のファイルがあればそれ、なければ（名前が変わった・archive/ に移ったなど）ID で探す。
  // 同じ ID のファイルが2つある（同期の競合コピーなど）ときに、リンクしたほうを選ぶため
  const targetOf = useCallback(
    (entry: DayEntry): Target => {
      if (!entry.href) return null
      let path = entry.href.split(/[?#]/)[0]
      try {
        path = decodeURIComponent(path)
      } catch {
        // % の書き方が崩れていても、そのまま読む
      }
      const exact = path.startsWith('../') ? byPath.get(path.slice(3)) : undefined
      if (exact) return exact
      const id = idFromHref(entry.href)
      return id ? (byId.get(id) ?? null) : null
    },
    [byId, byPath]
  )

  const entries = useMemo(() => content?.entries ?? [], [content])
  const placedIds = useMemo(
    () =>
      new Set(
        entries.flatMap((e) => {
          const id = e.href ? idFromHref(e.href) : null
          return id ? [id] : []
        })
      ),
    [entries]
  )
  const candidates = useMemo(
    () => dayCandidates(tickets, date, placedIds),
    [tickets, date, placedIds]
  )
  const others = useMemo(
    () => (query.trim() === '' ? [] : otherTickets(tickets, candidates, placedIds, query)),
    [tickets, candidates, placedIds, query]
  )

  // 作業する時間に入り切るかの目安。数えるのは、まずやる候補（期限まで・作業中）だけ。
  // 所要時間のないものは、置くときと同じ30分で数える（skill の mokkan-planning-days と同じ）
  const workMinutes = workHours.end - workHours.start
  const busyMin = busyMinutes(text === null ? preview : entries, workHours)
  const freeMin = Math.max(0, workMinutes - busyMin)
  const candidateMin = candidates.focus.reduce(
    (sum, t) => sum + (t.estimate ?? DEFAULT_TICKET_MINUTES),
    0
  )
  const noEstimate = candidates.focus.filter((t) => t.estimate === null).length

  /**
   * 裏方に書き換えを頼む。続けて頼まれたら、前の書き換えが終わってから、その結果を base にして順に送る
   * （前の結果を待たずに送ると、自分の操作なのに「ほかで書き換えられた」になってしまう）
   * 外で変わっていたら読み直して知らせる
   */
  const edit = useCallback(
    (change: DayEdit): Promise<boolean> => {
      setPending((n) => n + 1)
      const run = queueRef.current.then(async (): Promise<boolean> => {
        try {
          // 頼んだ後に日を移っていたら、手元の中身は別の日のものなので、その日を読み直して base にする
          const base =
            textRef.current?.date === date
              ? textRef.current.text
              : (await window.api.readDay(date)).text
          const result = await window.api.updateDay(date, base, change)
          if (result.status === 'saved') {
            setText(date, result.text)
            return true
          }
          const again = await window.api.readDay(date)
          setText(date, again.text)
          if (date === dateRef.current) setRoutineText(again.routine)
          onError(
            '時間割がほかで書き換えられていたので、読み直しました。もう一度操作してください。'
          )
          return false
        } catch (e) {
          onError(`時間割を書き換えられませんでした：${errorText(e)}`)
          return false
        } finally {
          setPending((n) => n - 1)
        }
      })
      queueRef.current = run.catch(() => undefined)
      return run
    },
    [date, onError, setText]
  )

  /** 時間の欄の y 座標（画面の座標）から、0時からの分 */
  const minuteAt = (clientY: number): number => {
    const rect = gridRef.current!.getBoundingClientRect()
    return (clientY - rect.top) / PX_PER_MIN
  }

  // ---- 予定を動かす・長さを変える ----
  // 動かしている途中の値は ref にも持つ。書き換え（edit）は setDrag の中では呼ばない
  // （React の開発中の StrictMode は、setState に渡した関数を2回呼ぶので、2回書きに行ってしまう）
  const dragRef = useRef<Drag | null>(null)
  const startDrag = (next: Drag): void => {
    dragRef.current = next
    setDrag(next)
  }
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      const delta = snap((e.clientY - d.startY) / PX_PER_MIN)
      const length = d.entry.end - d.entry.start
      let next: Drag
      if (d.mode === 'move') {
        const start = clampStart(d.entry.start + delta, length)
        next = { ...d, start, end: start + length, moved: d.moved || delta !== 0 }
      } else {
        const end = Math.min(Math.max(d.entry.end + delta, d.entry.start + SNAP), MINUTES_PER_DAY)
        next = { ...d, end, moved: d.moved || delta !== 0 }
      }
      dragRef.current = next
      setDrag(next)
    }
    const onUp = (): void => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      if (d.moved && (d.start !== d.entry.start || d.end !== d.entry.end)) {
        void edit({
          kind: 'update',
          line: d.entry.line,
          raw: d.entry.raw,
          start: d.start,
          end: d.end,
          content: d.entry.content
        })
      } else if (!d.moved && d.mode === 'move') {
        // 動かさずに離したら、リンク先を開く
        const target = targetOf(d.entry)
        if (target?.kind === 'ticket') onOpen(target.ticket.fileName)
        else if (target?.kind === 'note') onOpen(target.note.fileName)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, edit, targetOf, onOpen])

  // ---- 候補をドラッグして置く ----
  const onDrop = (e: React.DragEvent): void => {
    const fileName = e.dataTransfer.getData(TICKET_MIME)
    const ticket = tickets.find((t) => t.fileName === fileName)
    if (!ticket) return
    e.preventDefault()
    const length = ticket.estimate ?? DEFAULT_TICKET_MINUTES
    const start = clampStart(snap(minuteAt(e.clientY)), length)
    void edit({
      kind: 'add',
      start,
      end: start + length,
      content: linkTo(ticket.fileName, ticket.title)
    })
  }

  /** チケットを完了にする。押し間違えても状態が変わらないよう、確かめてから */
  const complete = async (ticket: Ticket): Promise<void> => {
    const title = ticket.title || '（タイトルなし）'
    const repeat = ticket.repeat ? '繰り返しがあるので、次回分のチケットもできます。' : ''
    if (
      !window.confirm(
        `「${title}」を完了にしますか？\nチケットの状態が「完了」になります。${repeat}`
      )
    ) {
      return
    }
    try {
      await window.api.completeTicket(ticket.fileName)
    } catch (e) {
      onError(`完了にできませんでした：${errorText(e)}`)
    }
  }

  /**
   * 予定を時間割から外す。文字だけの予定（MTG など）は、外すと内容ごとなくなるので確かめてから。
   * チケットやノートへのリンクの予定は、チケットやノートが残るので、そのまま外す
   */
  const removeEntry = (entry: DayEntry, label: string): void => {
    if (entry.href === null && !window.confirm(`「${label}」を時間割から外しますか？`)) return
    void edit({ kind: 'remove', line: entry.line, raw: entry.raw })
  }

  /** いつもの予定のうち、その日に当たるもの（今日と先の日だけ） */
  const routineToday = useMemo(
    () => (date >= today && routineText ? routineFor(parseRoutine(routineText), date) : []),
    [date, today, routineText]
  )
  /**
   * 日のファイルはあるのに、そこにないいつもの予定（手で作った・AI が写し忘れたなど）。
   * 黙って消えないよう、知らせて「写す」で足せるようにする
   */
  const missing = useMemo(
    () =>
      text === null
        ? []
        : missingRoutine(routineToday, entries).filter(
            (r) => !skipped.has(skipKey(date, r.content))
          ),
    [text, entries, routineToday, skipped, date]
  )

  /**
   * いつもの予定（点線）を、この日だけ外す。ファイルを作って（いつもの予定を写して）から、その行を消す
   * （「今日だけ定例が休み」のとき）
   */
  const skipRoutine = async (r: { start: number; end: number; content: string }): Promise<void> => {
    if (!window.confirm(`この日だけ「${r.content}」を外しますか？（いつもの予定はそのまま）`))
      return
    if (!(await edit({ kind: 'touch' }))) return
    const raw = entryLine(r.start, r.end, r.content)
    try {
      // 書き込みの途中で日を移っていたら、手元の中身は別の日のものなので、その日を読み直す
      const current =
        textRef.current?.date === date
          ? textRef.current.text
          : (await window.api.readDay(date)).text
      const line = current?.split(/\r?\n/).indexOf(raw) ?? -1
      if (line < 0) {
        onError(`「${r.content}」が時間割に見つからなかったので、外せませんでした。`)
        return
      }
      setSkipped((prev) => new Set(prev).add(skipKey(date, r.content)))
      await edit({ kind: 'remove', line, raw })
    } catch (e) {
      onError(`時間割を読めませんでした：${errorText(e)}`)
    }
  }

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const shown = text === null ? [] : entries
  const placed = layoutColumns(
    shown.map((entry) =>
      drag && drag.entry.line === entry.line
        ? { entry, start: drag.start, end: drag.end }
        : { entry, start: entry.start, end: entry.end }
    )
  )

  return (
    <div className="timetable">
      <div className="timetable-bar">
        <button className="ghost" onClick={() => onDateChange(addDays(date, -1))} title="前の日">
          ←
        </button>
        <button className="ghost" onClick={() => onDateChange(today)} disabled={date === today}>
          今日
        </button>
        <button className="ghost" onClick={() => onDateChange(addDays(date, 1))} title="次の日">
          →
        </button>
        <h2 className="timetable-date">{dateLabel(date)}</h2>
        {/* 日付を選んで、その日に移る（打ち込んでいる途中の読めない日付では移らない） */}
        <input
          type="date"
          className="timetable-jump"
          value={date}
          aria-label="日付を選んで移る"
          title="日付を選んで移る"
          onChange={(e) => {
            // 年を打ち込んでいる途中（0002-11-24 など）では移らない
            const value = e.target.value
            if (isValidDate(value) && value >= MIN_JUMP_DATE) onDateChange(value)
          }}
        />
        <span
          className="timetable-summary"
          title="作業する時間は、設定か days/routine.md の work で変えられます"
        >
          作業する時間 {formatTime(workHours.start)}〜{formatTime(workHours.end)} ／ 空き{' '}
          {freeMin === 0 ? 'なし' : durationLabel(freeMin)} ／ まずやる候補{' '}
          {candidates.focus.length} 件
          {candidates.focus.length > 0 && `（所要時間 計${durationLabel(candidateMin)}`}
          {noEstimate > 0 && `。所要時間なしの ${noEstimate} 件は30分で数えています`}
          {candidates.focus.length > 0 && '）'}
          {candidateMin > freeMin && <strong className="timetable-over"> 入り切りません</strong>}
        </span>
      </div>

      <div className="timetable-body">
        <aside className="timetable-candidates" aria-label="この日の候補">
          <p className="dialog-note">
            チケットは、時間の欄へドラッグして置きます。MTG
            などの予定は、空いている時間をダブルクリックして足します。
          </p>
          <h3>まずやる候補</h3>
          <p className="dialog-note">期限切れ・この日が期限・作業中</p>
          {candidates.focus.length === 0 && <p className="dialog-note">ありません。</p>}
          <CandidateList
            tickets={candidates.focus}
            date={date}
            selected={selected}
            onOpen={onOpen}
          />
          {candidates.started.length > 0 && (
            <details className="timetable-started">
              <summary>着手日を過ぎたもの（{candidates.started.length} 件）</summary>
              <CandidateList
                tickets={candidates.started}
                date={date}
                selected={selected}
                onOpen={onOpen}
              />
            </details>
          )}
          <h3>ほかのチケットを置く</h3>
          <input
            type="search"
            className="timetable-search"
            value={query}
            placeholder="タイトルで探す"
            aria-label="置くチケットをタイトルで探す"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() !== '' && others.length === 0 && (
            <p className="dialog-note">見つかりません。</p>
          )}
          <CandidateList
            tickets={others.slice(0, MAX_OTHERS)}
            date={date}
            selected={selected}
            onOpen={onOpen}
          />
          {others.length > MAX_OTHERS && (
            <p className="dialog-note">
              ほかに {others.length - MAX_OTHERS} 件。語を足して絞ってください。
            </p>
          )}
        </aside>

        <div className="timetable-scroll" ref={scrollRef}>
          {content && content.broken.length > 0 && (
            <div className="timetable-broken" role="status">
              読めない行（時刻の書き方が違うので、時間割に出していません。ファイルを直してください）：
              <ul>
                {content.broken.map((b) => (
                  <li key={b.line}>
                    <code>{b.raw}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loaded && text === null && preview.length > 0 && (
            <p className="timetable-preview-note">
              点線は、いつもの予定（days/routine.md）です。この日に予定を足すと、時間割のファイルを作って写します。この日だけ休みの予定は「この日は外す」で外せます。
            </p>
          )}
          {/* この日だけ外した予定のこともあるので、警告ではなく控えめな案内にする */}
          {missing.length > 0 && (
            <div className="timetable-routine-missing" role="status">
              いつもの予定のうち、この日の時間割にないもの（この日は外したか、写し忘れ）：
              <ul>
                {missing.map((r) => (
                  <li key={`${r.start}-${r.content}`}>
                    {formatTime(r.start)}-{formatTime(r.end)} {r.content}{' '}
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() =>
                        void edit({ kind: 'add', start: r.start, end: r.end, content: r.content })
                      }
                    >
                      写す
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div
            className="timetable-grid"
            ref={gridRef}
            style={{ height: HOUR_PX * 24 }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(TICKET_MIME)) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={onDrop}
            onDoubleClick={(e) => {
              if (e.target !== gridRef.current && !(e.target as HTMLElement).dataset.slot) return
              setEditing(null)
              setAdding(clampStart(Math.floor(minuteAt(e.clientY) / SNAP) * SNAP, SNAP))
            }}
          >
            <div
              className="timetable-work"
              style={{
                top: workHours.start * PX_PER_MIN,
                height: (workHours.end - workHours.start) * PX_PER_MIN
              }}
              data-slot="1"
            />
            {hours.map((h) => (
              <div key={h} className="timetable-hour" style={{ top: h * HOUR_PX }} data-slot="1">
                <span className="timetable-hour-label">{h}:00</span>
              </div>
            ))}
            {date === today && (
              <div
                className="timetable-now"
                style={{ top: nowMin * PX_PER_MIN }}
                aria-hidden="true"
              />
            )}

            {preview.map((r, i) => (
              <div
                key={`preview-${i}`}
                className={`timetable-entry preview${isShort(r.start, r.end) ? ' short' : ''}`}
                style={{ top: r.start * PX_PER_MIN, height: entryHeight(r.start, r.end) }}
                title="いつもの予定（まだファイルにありません）"
                tabIndex={0}
              >
                <span className="timetable-time">
                  {formatTime(r.start)}-{formatTime(r.end)}
                </span>
                <span className="timetable-label">{r.content}</span>
                <span className="timetable-actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    title="この日だけ、このいつもの予定を外す（時間割のファイルを作って写し、この行を消す）"
                    onClick={() => void skipRoutine(r)}
                  >
                    この日は外す
                  </button>
                </span>
              </div>
            ))}

            {placed.map(({ item, column, columns }) => {
              const { entry, start, end } = item
              const target = targetOf(entry)
              const label =
                target?.kind === 'ticket'
                  ? target.ticket.title || '（タイトルなし）'
                  : target?.kind === 'note'
                    ? target.note.title || '（タイトルなし）'
                    : (entry.label ?? entry.content)
              const fileName =
                target?.kind === 'ticket'
                  ? target.ticket.fileName
                  : target?.kind === 'note'
                    ? target.note.fileName
                    : null
              const done = target?.kind === 'ticket' && target.ticket.status === 'done'
              const plain = entry.href === null
              return (
                <div
                  key={entry.line}
                  className={[
                    'timetable-entry',
                    target?.kind ?? (entry.href ? 'missing' : 'plain'),
                    done ? 'done' : '',
                    fileName && fileName === selected ? 'selected' : '',
                    drag?.entry.line === entry.line ? 'dragging' : '',
                    isShort(start, end) ? 'short' : ''
                  ].join(' ')}
                  style={{
                    top: start * PX_PER_MIN,
                    height: entryHeight(start, end),
                    left: `calc(52px + (100% - 56px) * ${column / columns})`,
                    width: `calc((100% - 56px) / ${columns} - 2px)`
                  }}
                  title={`${formatTime(start)}-${formatTime(end)} ${label}`}
                  // キーボードでも予定に移れるようにする（移ると、予定のボタンが出る）。Enter でリンク先を開く
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget && fileName)
                      onOpen(fileName)
                  }}
                  onPointerDown={(e) => {
                    if (
                      busy ||
                      e.button !== 0 ||
                      (e.target as HTMLElement).closest('button, input')
                    ) {
                      return
                    }
                    e.preventDefault()
                    startDrag({
                      entry,
                      mode: 'move',
                      startY: e.clientY,
                      start: entry.start,
                      end: entry.end,
                      moved: false
                    })
                  }}
                >
                  <span className="timetable-time">
                    {formatTime(start)}-{formatTime(end)}
                  </span>
                  {editing === entry.line ? (
                    <EntryInput
                      initial={entry.content}
                      submitLabel="保存"
                      onSubmit={(value) => {
                        setEditing(null)
                        if (value !== entry.content) {
                          void edit({
                            kind: 'update',
                            line: entry.line,
                            raw: entry.raw,
                            start: entry.start,
                            end: entry.end,
                            content: value
                          })
                        }
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span className="timetable-label">
                      {label}
                      {target === null && entry.href && ' （リンク先が見つかりません）'}
                      {target?.kind === 'ticket' &&
                        target.ticket.status &&
                        target.ticket.status !== 'todo' &&
                        ` ・${STATUS_LABELS[target.ticket.status]}`}
                    </span>
                  )}
                  <span
                    className="timetable-actions"
                    // 書き換えている間は、入力欄の決める・やめるのボタンだけを出す
                    hidden={editing === entry.line}
                  >
                    {/* 記号（✓ など）は「置くのを決める」ボタンと間違えやすいので、どのボタンも文字で書く */}
                    {target?.kind === 'ticket' && !done && !target.ticket.archived && (
                      <button
                        className="ghost"
                        title="チケットを完了にする（確かめてから）"
                        onClick={() => void complete(target.ticket)}
                      >
                        完了にする
                      </button>
                    )}
                    {plain && (
                      <>
                        <button
                          className="ghost"
                          title="内容を書き換える"
                          onClick={() => {
                            setAdding(null)
                            setEditing(entry.line)
                          }}
                        >
                          書き換え
                        </button>
                        <button
                          className="ghost"
                          title="この予定の議事メモを作る（ノートを作り、この行をそのノートへのリンクにする）"
                          onClick={() => setMeeting(entry)}
                        >
                          議事メモ
                        </button>
                      </>
                    )}
                    <button
                      className="ghost danger"
                      title="時間割からこの予定を外す（チケットやノートは消さない）"
                      onClick={() => removeEntry(entry, label)}
                    >
                      外す
                    </button>
                  </span>
                  <span
                    className="timetable-resize"
                    title="ドラッグして長さを変える"
                    onPointerDown={(e) => {
                      if (busy || e.button !== 0) return
                      e.preventDefault()
                      e.stopPropagation()
                      startDrag({
                        entry,
                        mode: 'resize',
                        startY: e.clientY,
                        start: entry.start,
                        end: entry.end,
                        moved: false
                      })
                    }}
                  />
                </div>
              )
            })}

            {adding !== null && (
              <div
                className="timetable-entry adding"
                style={{ top: adding * PX_PER_MIN, height: DEFAULT_EVENT_MINUTES * PX_PER_MIN }}
              >
                <span className="timetable-time">
                  {formatTime(adding)}-
                  {formatTime(Math.min(adding + DEFAULT_EVENT_MINUTES, MINUTES_PER_DAY))}
                </span>
                <EntryInput
                  initial=""
                  placeholder="予定（MTG・昼休みなど）"
                  submitLabel="追加"
                  onSubmit={(value) => {
                    const start = adding
                    setAdding(null)
                    if (value === '') return
                    void edit({
                      kind: 'add',
                      start,
                      end: Math.min(start + DEFAULT_EVENT_MINUTES, MINUTES_PER_DAY),
                      content: value
                    })
                  }}
                  onCancel={() => setAdding(null)}
                />
              </div>
            )}
          </div>
          <p className="timetable-hint">
            ファイル：days/{date}.md
            {text !== null ? `（${entries.length} 件）` : '（まだありません）'}
          </p>
        </div>
      </div>

      {meeting && (
        <MeetingNoteDialog
          entry={meeting}
          date={date}
          noteFolders={noteFolders}
          onClose={() => setMeeting(null)}
          onCreated={async (fileName, title) => {
            setMeeting(null)
            const ok = await edit({
              kind: 'update',
              line: meeting.line,
              raw: meeting.raw,
              start: meeting.start,
              end: meeting.end,
              content: linkTo(fileName, title)
            })
            onOpen(fileName)
            if (!ok) {
              onError(
                `議事メモは作りましたが、時間割の行を書き換えられませんでした。行を「${entryLine(meeting.start, meeting.end, linkTo(fileName, title))}」に直してください。`
              )
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * 予定の内容の入力欄と、決める・やめるのボタン。Enter で決め、Esc でやめる。外を押しても決める
 * 決めるボタンは「追加」「保存」と文字で書く（チケットの「完了にする」と見間違えないように）
 */
function EntryInput({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: string
  placeholder?: string
  submitLabel: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (submit: boolean): void => {
    if (done.current) return
    done.current = true
    if (submit) onSubmit(value.trim())
    else onCancel()
  }
  // ボタンを押したときに入力欄からフォーカスが外れると、外を押したとみなして決めてしまうので、外さない
  const keepFocus = (e: React.MouseEvent): void => e.preventDefault()
  return (
    <span className="timetable-edit">
      <input
        className="timetable-input"
        autoFocus
        value={value}
        maxLength={500}
        placeholder={placeholder}
        aria-label="予定の内容"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // 日本語入力の変換を決めた Enter では決めない
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        }}
        // 外をクリックしたら決める。ただし、ほかのウィンドウに切り替えた（Alt+Tab など）だけなら決めない
        // （入力の途中の文で予定ができてしまうため。戻ってきたら続きを打てる）
        onBlur={() => {
          if (document.hasFocus()) finish(true)
        }}
      />
      <button
        type="button"
        className="primary"
        onMouseDown={keepFocus}
        onClick={() => finish(true)}
      >
        {submitLabel}
      </button>
      <button type="button" className="ghost" onMouseDown={keepFocus} onClick={() => finish(false)}>
        やめる
      </button>
    </span>
  )
}

/** MTG の予定から議事メモを作る窓（テンプレートとフォルダを選ぶ） */
function MeetingNoteDialog({
  entry,
  date,
  noteFolders,
  onClose,
  onCreated
}: {
  entry: DayEntry
  date: string
  noteFolders: string[]
  onClose: () => void
  onCreated: (fileName: string, title: string) => Promise<void>
}): React.JSX.Element {
  const [templates, setTemplates] = useState<TemplateList | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [title, setTitle] = useState(entry.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .listTemplates()
      .then((list) => {
        setTemplates(list)
        // 議事メモのテンプレートがあれば、それを初めに選ぶ
        if (list.notes.includes('議事メモ')) setTemplate('議事メモ')
      })
      .catch((e) => setError(errorText(e)))
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const create = async (): Promise<void> => {
    if (title.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      const { fileName } = await window.api.createNote({
        template,
        folder,
        title: title.trim(),
        date
      })
      await onCreated(fileName, title.trim())
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="meeting-title">議事メモを作る</h2>
        <p className="dialog-note">
          ノートを作り、時間割の「{entry.content}
          」の行をそのノートへのリンクにします。ノートの日付は {date} にします。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <label className="dialog-field">
            <span>タイトル</span>
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="dialog-field">
            <span>テンプレート</span>
            <select
              value={template ?? ''}
              disabled={templates === null}
              onChange={(e) => setTemplate(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">標準（NOTE_TEMPLATE.md）</option>
              {templates?.notes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="dialog-field">
            <span>フォルダ（プロジェクト）</span>
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">notes/ の直下</option>
              {noteFolders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="dialog-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
              作る
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TimetableView
