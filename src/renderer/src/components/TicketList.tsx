import type { Ticket } from '../../../shared/ticket'
import { effectivePriority } from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { PRIORITY_LABELS, STATUS_LABELS } from '../labels'
import { tagStyle } from '../tagStyle'

interface Props {
  tickets: Ticket[]
  today: string
  /** id → タイトル。親チケットの名前を出すのに使う */
  titles: Map<string, string>
  /** 編集画面で開いているチケットのファイル名 */
  selected: string | null
  /** タグの色（TAGS.md） */
  tagColors: TagColors
  onOpen: (fileName: string) => void
}

function TicketList({
  tickets,
  today,
  titles,
  selected,
  tagColors,
  onOpen
}: Props): React.JSX.Element {
  if (tickets.length === 0) {
    return <p className="empty">表示するチケットはありません。</p>
  }

  return (
    <ul className="tickets">
      {tickets.map((t) => {
        const priority = effectivePriority(t)
        const overdue = t.due !== null && t.due < today
        const parentTitle = t.parent ? titles.get(t.parent) : undefined
        return (
          <li key={t.fileName}>
            <button
              className={t.fileName === selected ? 'ticket selected' : 'ticket'}
              onClick={() => onOpen(t.fileName)}
              title={t.fileName}
            >
              <span className={`priority p${priority}`}>{PRIORITY_LABELS[priority]}</span>
              <span className="body">
                <span className={t.title ? 'title' : 'title untitled'}>
                  {t.title || '（タイトルなし）'}
                </span>
                <span className="meta">
                  {t.status && (
                    <span className={`status ${t.status}`}>{STATUS_LABELS[t.status]}</span>
                  )}
                  {t.tags.map((tag) => (
                    <span key={tag} className="tag tag-colored" style={tagStyle(tag, tagColors)}>
                      {tag}
                    </span>
                  ))}
                  {t.parent && <span className="parent">親：{parentTitle || t.parent}</span>}
                  {t.assignee.length > 0 && (
                    <span className="assignee">担当：{t.assignee.join('、')}</span>
                  )}
                </span>
              </span>
              <span className="dates">
                {t.due && <span className={overdue ? 'due overdue' : 'due'}>期限 {t.due}</span>}
                {t.start && <span className="start">着手 {t.start}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default TicketList
