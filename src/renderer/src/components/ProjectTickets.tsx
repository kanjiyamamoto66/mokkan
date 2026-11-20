// 入口のノートの編集画面に出す「このプロジェクトのチケット（未完了）」
// プロジェクトの進み具合は入口のノートに書かず、チケットだけに持たせる決まりなので、入口からたどれるようにする

import { useMemo } from 'react'
import { indexProjectTag, projectOpenTickets, type Note } from '../../../shared/note'
import type { Ticket } from '../../../shared/ticket'
import { STATUS_LABELS } from '../labels'

/** 出す件数の上限。超えたら「一覧で見る」。本文（目的・知識の状況）を下に押し出しすぎないように少なめにする */
const MAX_ITEMS = 5

interface Props {
  note: Pick<Note, 'type' | 'folder'>
  tickets: Ticket[]
  /** 今日（YYYY-MM-DD）。これより前の期限は一覧と同じく期限切れの色にする */
  today: string
  onOpen: (fileName: string) => void
  /** そのタグで絞り込んだ一覧に切り替える */
  onShowTag: (tag: string) => void
}

function ProjectTickets({
  note,
  tickets,
  today,
  onOpen,
  onShowTag
}: Props): React.JSX.Element | null {
  const tag = indexProjectTag(note)
  const open = useMemo(() => projectOpenTickets(note, tickets), [note, tickets])
  if (tag === null) return null

  return (
    <div
      className="project-tickets"
      title={`タグ「${tag}」が付いた、完了していないチケット（期限の近い順）`}
    >
      <span className="label">このプロジェクトのチケット（未完了）</span>
      {open.length === 0 ? (
        <span className="none">なし</span>
      ) : (
        <ul>
          {open.slice(0, MAX_ITEMS).map((t) => (
            <li key={t.fileName}>
              {t.status && <span className={`status ${t.status}`}>{STATUS_LABELS[t.status]}</span>}
              <button className="link" onClick={() => onOpen(t.fileName)} title={t.fileName}>
                {t.title || '（タイトルなし）'}
              </button>
              {t.due && <span className={t.due < today ? 'due overdue' : 'due'}>期限 {t.due}</span>}
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <button className="link show-all" onClick={() => onShowTag(tag)}>
          {open.length > MAX_ITEMS
            ? `ほか ${open.length - MAX_ITEMS} 件を一覧で見る`
            : '一覧で見る'}
        </button>
      )}
    </div>
  )
}

export default ProjectTickets
