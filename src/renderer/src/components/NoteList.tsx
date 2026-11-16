import { noteDate, ticketsFromNote, type Note } from '../../../shared/note'
import type { TagColors } from '../../../shared/tagColor'
import type { Ticket } from '../../../shared/ticket'
import { NOTE_TYPE_HINTS, NOTE_TYPE_LABELS } from '../labels'
import { tagStyle } from '../tagStyle'

interface Props {
  notes: Note[]
  tickets: Ticket[]
  /** 左の木で選んでいるフォルダ（空文字ならすべて）。ノートのフォルダは、ここからの相対で出す */
  folder: string
  /** 編集画面で開いているファイルのキー */
  selected: string | null
  /** タグの色（TAGS.md） */
  tagColors: TagColors
  onOpen: (fileName: string) => void
}

/** ノートの一覧。日付・タイトル・種類・フォルダ・タグと、このノートから起こしたチケットの進み具合を出す */
function NoteList({
  notes,
  tickets,
  folder,
  selected,
  tagColors,
  onOpen
}: Props): React.JSX.Element {
  if (notes.length === 0) {
    return (
      <p className="empty">
        表示するノートはありません。「＋ 新規ノート」でメモや議事メモなどを書けます。
      </p>
    )
  }

  return (
    <ul className="tickets notes">
      {notes.map((n) => {
        const from = ticketsFromNote(n, tickets)
        const done = from.filter((t) => t.status === 'done').length
        return (
          <li key={n.fileName}>
            <button
              className={n.fileName === selected ? 'ticket selected' : 'ticket'}
              onClick={() => onOpen(n.fileName)}
              title={n.fileName}
            >
              <span className="note-date">{noteDate(n) ?? '日付なし'}</span>
              <span className="body">
                <span className={n.title ? 'title' : 'title untitled'}>
                  {n.title || '（タイトルなし）'}
                </span>
                <span className="meta">
                  {n.type !== 'record' && (
                    <span className={`note-type ${n.type}`} title={NOTE_TYPE_HINTS[n.type]}>
                      {NOTE_TYPE_LABELS[n.type]}
                    </span>
                  )}
                  {n.folder && n.folder !== folder && (
                    <span className="note-folder" title={`notes/${n.folder}`}>
                      {n.folder.startsWith(`${folder}/`)
                        ? n.folder.slice(folder.length + 1)
                        : n.folder}
                    </span>
                  )}
                  {n.tags.map((tag) => (
                    <span key={tag} className="tag tag-colored" style={tagStyle(tag, tagColors)}>
                      {tag}
                    </span>
                  ))}
                  {n.author && <span className="assignee">作成：{n.author}</span>}
                </span>
              </span>
              <span className="dates">
                {n.type === 'knowledge' && (
                  <span title="最後に見直した日">見直し {n.reviewed ?? '—'}</span>
                )}
                {from.length > 0 && (
                  <span
                    className={done === from.length ? 'from-note all-done' : 'from-note'}
                    title="このノートから起こしたチケット"
                  >
                    チケット {from.length}件中{done}件完了
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default NoteList
