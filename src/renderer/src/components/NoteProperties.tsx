// ノートの frontmatter を編集するフォーム（種類・日付・見直した日・フォルダ・作成者・タグ）と、このノートから起こしたチケット
// 項目は変えたものだけを onChange で渡す

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FieldUpdates } from '../../../shared/frontmatter'
import type { FromNoteRequest } from '../../../shared/api'
import {
  NOTE_TYPES,
  hasBackLink,
  noteTypeChange,
  parseHomeworkItem,
  ticketsFromNote,
  type Note,
  type NoteType
} from '../../../shared/note'
import { collectTags, formatDate, formatDateTime, type Ticket } from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { NOTE_TYPE_HINTS, NOTE_TYPE_LABELS, STATUS_LABELS } from '../labels'
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
  /** 保存したノートに「宿題」の見出しがあるか（あれば、起こしたチケットへのリンクを書き戻す） */
  hasHomework: () => boolean
  /** notes/ の下のフォルダ（移す先の候補） */
  folders: string[]
  /** ノートを別のフォルダに移す（空文字なら notes/ の直下） */
  onMove: (folder: string) => void
}

/** 「＋ ここからチケット」を押したときの初めの値 */
interface CreateDraft {
  title: string
  /** 選んでいた「宿題」の項目の文（その行に「→ リンク」を付ける） */
  homeworkItem: string | null
  /** 項目の「（高橋）」から拾った担当者 */
  assignee: string[]
  /** ノートに「宿題」の見出しがあるか（なければ書き戻さない） */
  hasHomework: boolean
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
        {!initial.hasHomework
          ? '「宿題」の見出しがないノートなので、ノートには書き足しません（チケットの「元のノート」からこのノートに戻れます）。'
          : initial.homeworkItem
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
  hasHomework,
  folders,
  onMove
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
  /** 「AI に頼む文をコピー」を押した直後か（ボタンの文字を「コピーしました」にする） */
  const [promptCopied, setPromptCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    []
  )
  // 文は裏方がノートのキーから作る（画面から任意の文字を渡さない）
  const copyPrompt = async (): Promise<void> => {
    setCopyError(null)
    try {
      await window.api.copyNotePrompt(note.fileName)
      setPromptCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setPromptCopied(false), 2000)
    } catch (e) {
      setCopyError(
        `コピーできませんでした：${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`
      )
    }
  }
  /** 「＋ ここからチケット」の入力欄を開いているときの初めの値 */
  const [creating, setCreating] = useState<CreateDraft | null>(null)
  // 移す先の候補。開いているノートのフォルダが一覧になくても（読み込みの途中など）選べるようにする
  const folderOptions = useMemo(
    () => [...new Set(['', ...folders, note.folder])].sort((a, b) => a.localeCompare(b, 'ja')),
    [folders, note.folder]
  )

  return (
    <div className="properties">
      <fieldset disabled={disabled}>
        <label title={NOTE_TYPE_HINTS[note.type]}>
          <span>種類</span>
          <select
            value={note.type}
            onChange={(e) =>
              onChange(
                noteTypeChange(e.target.value as NoteType, note.reviewed, formatDate(new Date()))
              )
            }
          >
            {NOTE_TYPES.map((t) => (
              <option key={t} value={t}>
                {NOTE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>日付</span>
          <input
            type="date"
            value={note.date ?? ''}
            title="ノートの日付（会議の日、書いた日など）"
            onChange={(e) => onChange({ date: e.target.value || null })}
          />
        </label>
        {note.type === 'knowledge' && (
          <div className="field wide">
            <span>見直した日</span>
            <span className="reviewed-field">
              <input
                type="date"
                value={note.reviewed ?? ''}
                title="中身が今も正しいかを最後に確かめた日"
                onChange={(e) => onChange({ reviewed: e.target.value || null })}
              />
              <button
                type="button"
                className="ghost"
                title="中身が今も正しいことを確かめたら押します"
                onClick={() => onChange({ reviewed: formatDate(new Date()) })}
              >
                今日見直した
              </button>
            </span>
          </div>
        )}
        <label title="notes/ の中のフォルダ。選ぶと、そのフォルダに移します">
          <span>フォルダ</span>
          <select value={note.folder} onChange={(e) => onMove(e.target.value)}>
            {folderOptions.map((f) => (
              <option key={f} value={f}>
                {f === '' ? '（notes/ の直下）' : f}
              </option>
            ))}
          </select>
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
            keyValue
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
                assignee: parsed?.assignees ?? [],
                hasHomework: hasHomework()
              })
            }}
          >
            ＋ ここからチケット
          </button>
        ) : null}
        {creating === null && (
          <button
            className="ghost from-note-add"
            title="このノートからタスクを起こしてもらう文をコピーします。AI のアプリ（Claude Code・Cursor など）で mokkan のデータのフォルダを開いて貼ると、候補を出してくれます（作るのは確かめてから）"
            onClick={() => void copyPrompt()}
          >
            {promptCopied ? 'コピーしました' : 'AI に頼む文をコピー'}
          </button>
        )}
        {copyError && <p className="dialog-error">{copyError}</p>}
        {creating !== null && (
          <CreateFromNote
            initial={creating}
            onCreate={onCreateTicket}
            onCancel={() => setCreating(null)}
          />
        )}
      </div>
    </div>
  )
}

export default NoteProperties
