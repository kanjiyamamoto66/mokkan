// frontmatter を編集するフォーム。変えた項目だけを onChange で渡す

import { useMemo, useState } from 'react'
import { assigneeField, type FieldUpdates } from '../../../shared/frontmatter'
import { listNotes, noteDate, type Note } from '../../../shared/note'
import {
  STATUSES,
  collectAssignees,
  collectTags,
  createdLabel,
  effectivePriority,
  formatDateTime,
  type Priority,
  type Ticket
} from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { PRIORITY_LABELS, STATUS_LABELS } from '../labels'
import { saveTagColor } from '../tagStyle'
import RepeatInput from './RepeatInput'
import TagInput from './TagInput'

interface Props {
  ticket: Ticket
  tickets: Ticket[]
  notes: Note[]
  today: string
  /** タグの色（TAGS.md） */
  tagColors: TagColors
  disabled?: boolean
  onChange: (updates: FieldUpdates) => void
  onOpen: (fileName: string) => void
}

const PRIORITIES: Priority[] = [1, 2, 3]

/** 入力中は手元に持ち、確定（フォーカスが外れる・Enter）したときだけ渡すテキスト欄 */
export function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  // ファイル側の値が変わったら、入力中の値もそれに揃える
  const [lastValue, setLastValue] = useState(value)
  if (lastValue !== value) {
    setLastValue(value)
    setDraft(value)
  }
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // 日本語入力の変換を確定する Enter では確定しない
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit()
      }}
    />
  )
}

/** 親として選べないチケット（自分と、自分の子孫）の id */
function descendantsOf(id: string | null, tickets: Ticket[]): Set<string> {
  const result = new Set<string>()
  if (!id) return result
  result.add(id)
  let added = true
  while (added) {
    added = false
    for (const t of tickets) {
      if (t.id && t.parent && result.has(t.parent) && !result.has(t.id)) {
        result.add(t.id)
        added = true
      }
    }
  }
  return result
}

function PropertyForm({
  ticket,
  tickets,
  notes,
  today,
  tagColors,
  disabled,
  onChange,
  onOpen
}: Props): React.JSX.Element {
  // 元のノートの選択肢（新しい順）
  const noteOptions = useMemo(() => listNotes(notes, []).filter((n) => n.id), [notes])
  const sourceNote = ticket.source ? notes.find((n) => n.id === ticket.source) : undefined
  const children = useMemo(
    () => (ticket.id ? tickets.filter((t) => t.parent === ticket.id) : []),
    [ticket.id, tickets]
  )
  const parentOptions = useMemo(() => {
    const excluded = descendantsOf(ticket.id, tickets)
    return tickets
      .filter((t) => t.id && !excluded.has(t.id) && t.status !== 'done')
      .sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName, 'ja'))
  }, [ticket.id, tickets])
  // 担当者・作成者の入力の候補（これまでに入力された名前）
  const people = useMemo(
    () =>
      [
        ...new Set([
          ...collectAssignees(tickets),
          ...tickets.flatMap((t) => (t.author ? [t.author] : []))
        ])
      ].sort((a, b) => a.localeCompare(b, 'ja')),
    [tickets]
  )
  const allTags = useMemo(() => collectTags(tickets), [tickets])
  // 編集画面のチケットは画面で読み直したものなので、更新日時は裏方の一覧から取る
  const modified = tickets.find((t) => t.fileName === ticket.fileName)?.modified ?? null
  const parentMissing = ticket.parent !== null && !tickets.some((t) => t.id === ticket.parent)

  const changeStatus = (status: string): void => {
    const updates: FieldUpdates = { status }
    // 完了にしたら完了日を入れ、完了から戻したら消す
    if (status === 'done' && !ticket.done) updates.done = today
    if (status !== 'done' && ticket.status === 'done') updates.done = null
    onChange(updates)
  }

  return (
    <div className="properties">
      <fieldset disabled={disabled}>
        <label>
          <span>状態</span>
          <select value={ticket.status ?? ''} onChange={(e) => changeStatus(e.target.value)}>
            {ticket.status === null && <option value="">（未設定）</option>}
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>優先度</span>
          <span className="priority-field">
            <span className={`priority-dot p${effectivePriority(ticket)}`} aria-hidden />
            <select
              value={effectivePriority(ticket)}
              onChange={(e) => onChange({ priority: Number(e.target.value) })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label>
          <span>着手日</span>
          <input
            type="date"
            value={ticket.start ?? ''}
            onChange={(e) => onChange({ start: e.target.value || null })}
          />
        </label>
        <label>
          <span>期限</span>
          <input
            type="date"
            value={ticket.due ?? ''}
            onChange={(e) => onChange({ due: e.target.value || null })}
          />
        </label>
        {/* 担当者は複数人入れられる（タグと同じ入力欄。1人なら文字列、2人以上ならリストで書く） */}
        <div className="field wide">
          <span>担当者</span>
          <TagInput
            tags={ticket.assignee}
            suggestions={people}
            label="担当者"
            placeholder="なし"
            onChange={(names) => onChange({ assignee: assigneeField(names) })}
          />
        </div>
        <label>
          <span>作成者</span>
          <CommitInput
            value={ticket.author ?? ''}
            list="person-options"
            placeholder="なし"
            onCommit={(v) => onChange({ author: v.trim() || null })}
          />
          {/* 担当者と作成者の候補は共通（これまでに入力された名前） */}
          <datalist id="person-options">
            {people.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        {/* 中にボタンがある欄は、label で囲むとどこを押しても最初のボタンが押されるので div にする */}
        <div className="field wide">
          <span>繰り返し</span>
          <RepeatInput
            value={ticket.repeat}
            anchor={ticket.start ?? ticket.due}
            onChange={(repeat) => onChange({ repeat })}
          />
        </div>
        <div className="field wide">
          <span>タグ</span>
          <TagInput
            tags={ticket.tags}
            suggestions={allTags}
            onChange={(tags) => onChange({ tags })}
            colors={tagColors}
            onColorChange={saveTagColor}
          />
        </div>
        <label className="wide">
          <span>親チケット</span>
          <select
            value={ticket.parent ?? ''}
            onChange={(e) => onChange({ parent: e.target.value || null })}
          >
            <option value="">なし</option>
            {parentMissing && (
              <option value={ticket.parent!}>{ticket.parent}（見つかりません）</option>
            )}
            {parentOptions.map((t) => (
              <option key={t.fileName} value={t.id!}>
                {t.title || '（タイトルなし）'}
              </option>
            ))}
          </select>
        </label>
        {/* 開くボタンがあるので label で囲まない */}
        <div className="field wide">
          <span>元のノート</span>
          <div className="source-note">
            <select
              aria-label="元のノート"
              value={ticket.source ?? ''}
              onChange={(e) => onChange({ source: e.target.value || null })}
            >
              <option value="">なし</option>
              {ticket.source && !sourceNote && (
                <option value={ticket.source}>{ticket.source}（見つかりません）</option>
              )}
              {noteOptions.map((n) => (
                <option key={n.fileName} value={n.id!}>
                  {noteDate(n) ?? '日付なし'} {n.title || '（タイトルなし）'}
                </option>
              ))}
            </select>
            {sourceNote && (
              <button
                type="button"
                className="ghost"
                onClick={() => onOpen(sourceNote.fileName)}
                title="元のノートを開く"
              >
                開く
              </button>
            )}
          </div>
        </div>
      </fieldset>

      <p className="meta-line">
        ID {ticket.id ?? '（なし）'} ・ 作成 {createdLabel(ticket) ?? '—'}
        {modified !== null && ` ・ 更新 ${formatDateTime(new Date(modified))}`}
        {ticket.done && ` ・ 完了 ${ticket.done}`}
      </p>

      {children.length > 0 && (
        <div className="children">
          <span className="label">子チケット</span>
          <ul>
            {children.map((c) => (
              <li key={c.fileName}>
                <button className="link" onClick={() => onOpen(c.fileName)}>
                  {c.title || '（タイトルなし）'}
                </button>
                {c.status && (
                  <span className={`status ${c.status}`}>{STATUS_LABELS[c.status]}</span>
                )}
                {c.due && <span className="due">期限 {c.due}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default PropertyForm
