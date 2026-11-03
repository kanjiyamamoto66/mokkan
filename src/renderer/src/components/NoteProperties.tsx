// ノートの frontmatter を編集するフォーム（会議の日・タグ・作成者）と、このノートから起こしたチケット
// 項目は変えたものだけを onChange で渡す

import { useMemo, useRef, useState } from 'react'
import type { FieldUpdates } from '../../../shared/frontmatter'
import type { AiSuggestResult, FromNoteRequest } from '../../../shared/api'
import AiTasksDialog from './AiTasksDialog'
import { hasBackLink, parseHomeworkItem, ticketsFromNote, type Note } from '../../../shared/note'
import { collectTags, formatDateTime, type Ticket } from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { STATUS_LABELS } from '../labels'
import { saveTagColor } from '../tagStyle'
import { CommitInput } from './PropertyForm'
import TagInput from './TagInput'

interface Props {
  note: Note
  notes: Note[]
  tickets: Ticket[]
  /** タグの色（TAGS.md） */
  tagColors: TagColors
  disabled?: boolean
  onChange: (updates: FieldUpdates) => void
  onOpen: (fileName: string) => void
  /** タイトルを渡してチケットを起こす。作れなかったときは理由を返す */
  onCreateTicket: (
    title: string,
    request?: FromNoteRequest,
    open?: boolean
  ) => Promise<string | null>
  /** 本文で選んでいる文字（タイトルの初めの値に使う） */
  selectedText: () => string
  /** カーソルのある「宿題」の項目の文。「宿題」の中でなければ null */
  homeworkItem: () => string | null
  /** ノートを AI に送り、タスクの候補を出してもらう */
  onSuggestTasks: (includeTranscript: boolean) => Promise<AiSuggestResult>
  /** AI に送る本文の大きさと、「文字起こし」の節があるか */
  noteBodyInfo: () => { bodyLength: number; hasTranscript: boolean }
}

/** 「＋ ここからチケット」を押したときの初めの値 */
interface CreateDraft {
  title: string
  /** 選んでいた「宿題」の項目の文（その行に「→ リンク」を付ける） */
  homeworkItem: string | null
  /** 項目の「（高橋）」から拾った担当者 */
  assignee: string[]
}

/** 「＋ ここからチケット」のタイトルの入力欄 */
function CreateFromNote({
  onCreate,
  onCancel,
  initial
}: {
  onCreate: Props['onCreateTicket']
  onCancel: () => void
  initial: CreateDraft
}): React.JSX.Element {
  const [title, setTitle] = useState(initial.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    const reason = await onCreate(title.trim(), {
      homeworkItem: initial.homeworkItem,
      assignee: initial.assignee
    })
    setBusy(false)
    if (reason) setError(reason)
  }

  return (
    <form
      className="from-note-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        ref={inputRef}
        autoFocus
        value={title}
        maxLength={200}
        placeholder="チケットのタイトル"
        aria-label="チケットのタイトル"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button type="submit" className="primary" disabled={busy || title.trim() === ''}>
        作る
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        やめる
      </button>
      <small>
        {initial.homeworkItem
          ? `作ると、「宿題」の「${initial.homeworkItem}」の行の最後に「→ チケットへのリンク」を付けます。`
          : '作ると、このノートの「宿題」に「- タイトル → チケットへのリンク」を書き足します。'}
        {initial.assignee.length > 0 && `担当者：${initial.assignee.join('、')}`}
      </small>
      {error && <p className="dialog-error">{error}</p>}
    </form>
  )
}

function NoteProperties({
  note,
  notes,
  tickets,
  tagColors,
  disabled,
  onChange,
  onOpen,
  onCreateTicket,
  selectedText,
  homeworkItem,
  onSuggestTasks,
  noteBodyInfo
}: Props): React.JSX.Element {
  const allTags = useMemo(() => collectTags([...tickets, ...notes]), [tickets, notes])
  // 作成者の候補（これまでに入力された名前）
  const people = useMemo(
    () =>
      [
        ...new Set(
          [
            ...tickets.flatMap((t) => [...t.assignee, t.author]),
            ...notes.map((n) => n.author)
          ].filter((v): v is string => !!v)
        )
      ].sort((a, b) => a.localeCompare(b, 'ja')),
    [tickets, notes]
  )
  // 編集画面のノートは画面で読み直したものなので、更新日時は裏方の一覧から取る
  const modified = notes.find((n) => n.fileName === note.fileName)?.modified ?? null
  const fromNote = useMemo(() => ticketsFromNote(note, tickets), [note, tickets])
  /** AI に候補を出してもらう窓を開いているときの、本文の大きさ */
  const [aiInfo, setAiInfo] = useState<{ bodyLength: number; hasTranscript: boolean } | null>(null)
  /** 「＋ ここからチケット」の入力欄を開いているときの初めの値 */
  const [creating, setCreating] = useState<CreateDraft | null>(null)

  return (
    <div className="properties">
      <fieldset disabled={disabled}>
        <label>
          <span>会議などの日</span>
          <input
            type="date"
            value={note.date ?? ''}
            onChange={(e) => onChange({ date: e.target.value || null })}
          />
        </label>
        <label>
          <span>作成者</span>
          <CommitInput
            value={note.author ?? ''}
            list="note-person-options"
            placeholder="なし"
            onCommit={(v) => onChange({ author: v.trim() || null })}
          />
          <datalist id="note-person-options">
            {people.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <div className="field wide">
          <span>タグ</span>
          <TagInput
            tags={note.tags}
            suggestions={allTags}
            onChange={(tags) => onChange({ tags })}
            colors={tagColors}
            onColorChange={saveTagColor}
          />
        </div>
      </fieldset>

      <p className="meta-line">
        ID {note.id ?? '（なし）'} ・ 作成 {note.created ?? '—'}
        {modified !== null && ` ・ 更新 ${formatDateTime(new Date(modified))}`}
      </p>

      <div className="children from-note-tickets">
        <span className="label">このノートから作ったチケット</span>
        {fromNote.length > 0 && (
          <ul>
            {fromNote.map((t) => (
              <li key={t.fileName}>
                <button className="link" onClick={() => onOpen(t.fileName)}>
                  {t.title || '（タイトルなし）'}
                </button>
                {t.status && (
                  <span className={`status ${t.status}`}>{STATUS_LABELS[t.status]}</span>
                )}
                {t.assignee.length > 0 && <span className="due">担当 {t.assignee.join('、')}</span>}
                {t.due && <span className="due">期限 {t.due}</span>}
                {t.archived && <span className="due">アーカイブ済み</span>}
              </li>
            ))}
          </ul>
        )}
        {creating === null ? (
          <button
            className="ghost from-note-add"
            disabled={disabled || !note.id}
            title={
              note.id
                ? '「宿題」の項目にカーソルを置いて押すと、その行にリンクを付けます。文字を選んでから押すと、その文字がタイトルに入ります'
                : 'id がないノートからは作れません'
            }
            onClick={() => {
              // 「宿題」の項目にカーソルがあれば、その文をタイトルに、「（高橋）」を担当者にする（選んだ文字があればそちらを優先）
              const item = homeworkItem()
              const parsed = item ? parseHomeworkItem(item) : null
              setCreating({
                title: selectedText() || parsed?.title || '',
                // すでに「→」が付いている項目は、その行には付けず「宿題」の最後に行を足す
                homeworkItem: item && !hasBackLink(item) ? item : null,
                assignee: parsed?.assignees ?? []
              })
            }}
          >
            ＋ ここからチケット
          </button>
        ) : null}
        {creating === null && (
          <button
            className="ghost from-note-add"
            disabled={disabled || !note.id}
            title="このノートを AI（パソコンの Claude Code）に送り、タスクの候補を出してもらいます。選んでから作ります"
            onClick={() => setAiInfo(noteBodyInfo())}
          >
            AI でタスクを起こす…
          </button>
        )}
        {creating !== null && (
          <CreateFromNote
            initial={creating}
            onCreate={onCreateTicket}
            onCancel={() => setCreating(null)}
          />
        )}
      </div>
      {aiInfo && (
        <AiTasksDialog
          bodyLength={aiInfo.bodyLength}
          hasTranscript={aiInfo.hasTranscript}
          onSuggest={onSuggestTasks}
          onCancelSuggest={() => void window.api.cancelSuggestTasks()}
          // まとめて作るときは、作ったチケットを開かずにノートに留まる
          onCreate={(title, request) => onCreateTicket(title, request, false)}
          onClose={() => setAiInfo(null)}
        />
      )}
    </div>
  )
}

export default NoteProperties
