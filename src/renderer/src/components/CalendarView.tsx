// カレンダー（月表示）。due の日にチケットを置き、start があれば start から due までの帯にする
// クリックで編集画面を開く。マウスを乗せると「親 > 子」の経路を出す。ドラッグで日付を動かす機能は今後検討する（仕様書の「今後の候補」）

import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import jaLocale from '@fullcalendar/react/locales/ja'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/classic/theme.css'
import '@fullcalendar/react/themes/classic/palette.css'
import { useMemo } from 'react'
import { addDays, type CalendarItem } from '../../../shared/schedule'
import { tagHue, type TagColors } from '../../../shared/tagColor'
import { useDarkMode } from '../useDarkMode'
import Legend from './Legend'

interface Props {
  items: CalendarItem[]
  selected: string | null
  /** タグの色（TAGS.md）。選んでいないタグは名前から決める */
  tagColors: TagColors
  /** 凡例に出すタグ */
  tags: string[]
  onOpen: (fileName: string) => void
}

function eventClass(item: CalendarItem, selected: string | null, colors: TagColors): string {
  return [
    'mk-event',
    // 左の線は最初のタグの色。色相ごとの class に --tag-h を入れる（下の <style>）
    item.tag ? `tag-colored mk-tag mk-hue-${tagHue(item.tag, colors)}` : '',
    `mk-p${item.priority}`,
    item.status ? `mk-${item.status}` : '',
    item.overdue ? 'mk-overdue' : '',
    item.fileName === selected ? 'mk-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function CalendarView({ items, selected, tagColors, tags, onOpen }: Props): React.JSX.Element {
  const dark = useDarkMode()
  // FullCalendar の予定には style を渡せないので、使っている色相ごとに class を作る
  const hueStyles = useMemo(
    () =>
      [...new Set(items.flatMap((i) => (i.tag ? [tagHue(i.tag, tagColors)] : [])))]
        .map((h) => `.calendar .mk-hue-${h}{--tag-h:${h}}`)
        .join('\n'),
    [items, tagColors]
  )
  const events = useMemo(
    () =>
      items.map((item) => ({
        id: item.fileName,
        title: item.title || '（タイトルなし）',
        start: item.start,
        // 終日の予定の end は「その日を含まない」ので、最後の日の翌日を渡す
        end: addDays(item.end, 1),
        allDay: true,
        className: eventClass(item, selected, tagColors),
        // マウスを乗せたときに出す「親 > 子」の経路
        extendedProps: {
          tooltip: [...item.path, item.title || '（タイトルなし）'].join(' > '),
          // 名前の前に小さく出す、すぐ上の親のタイトル
          parentTitle: item.path.at(-1) ?? '',
          overdue: item.overdue,
          // 同じ日に並べる順（親子のまとまりの中では親が上。eventOrder で使う）
          // （FullCalendar は 0 を「値なし」と同じに扱うことがあるので、1から数える）
          mkOrder: item.order + 1,
          // 優先度の丸は、見た目が煩雑にならないよう「高」だけに出す
          high: item.priority === 1
        }
      })),
    [items, selected, tagColors]
  )

  return (
    <div className="calendar" data-color-scheme={dark ? 'dark' : 'light'}>
      {/* 見出しの真ん中（FullCalendar のツールバーの空いているところ）に「?」を置く */}
      <style>{hueStyles}</style>
      <Legend tags={tags} tagColors={tagColors} />
      <FullCalendar
        plugins={[dayGridPlugin, classicThemePlugin]}
        initialView="dayGridMonth"
        locale={jaLocale}
        height="100%"
        fixedWeekCount={false}
        dayMaxEvents
        eventOrder="mkOrder"
        headerToolbar={{ start: 'title', center: '', end: 'today prev,next' }}
        events={events}
        eventContent={(arg) => (
          // 中身は FullCalendar の既定の表示と同じ。名前にマウスを乗せると、親子の経路を出す
          <>
            {arg.timeText && <div className={arg.timeClass}>{arg.timeText}</div>}
            <div className={arg.titleClass} title={String(arg.event.extendedProps.tooltip ?? '')}>
              {arg.event.extendedProps.high && (
                <span className="priority-dot p1" title="優先度 高" />
              )}
              {arg.event.extendedProps.overdue && (
                <span className="overdue-mark" aria-label="期限切れ">
                  !
                </span>
              )}
              {arg.event.extendedProps.parentTitle && (
                <span className="mk-parent">{String(arg.event.extendedProps.parentTitle)} › </span>
              )}
              {arg.event.title}
            </div>
          </>
        )}
        eventClick={(info) => {
          info.jsEvent.preventDefault()
          onOpen(info.event.id)
        }}
      />
    </div>
  )
}

export default CalendarView
