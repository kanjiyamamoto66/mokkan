// 繰り返しの指定。種類を選ぶと、必要な項目（曜日・日・第何週など）だけを出す
// 書式（RULES.md の書き方）を直接書く欄も残し、AI や手で書いた値を壊さない。
// ただし普段はプルダウンで選んでもらうため、「書式で書く」を押したときと、読めない書式のときだけ出す

import { useState } from 'react'
import {
  MAX_INTERVAL,
  WEEKDAY_LABELS,
  describeRepeat,
  formatRepeat,
  parseRepeat,
  type NthWeek,
  type RepeatRule,
  type RepeatUnit
} from '../../../shared/repeat'

interface Props {
  value: string | null
  /** 繰り返しを当てはめる日（着手日、なければ期限）。種類を選んだときの曜日や日の初期値に使う */
  anchor: string | null
  onChange: (value: string | null) => void
}

type Kind = RepeatRule['kind'] | 'none' | 'custom'

const KIND_LABELS: Record<Kind, string> = {
  none: 'なし',
  daily: '毎日',
  weekdays: '平日（月〜金）',
  weekly: '毎週（曜日を選ぶ）',
  'monthly-day': '毎月（日を選ぶ）',
  'monthly-end': '毎月（月末）',
  'monthly-nth': '毎月（第◯曜日）',
  yearly: '毎年',
  every: '◯日・週・か月ごと',
  after: '完了から◯日・週・か月後',
  custom: '（書式が読めません）'
}
const KINDS: Kind[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly-day',
  'monthly-end',
  'monthly-nth',
  'yearly',
  'every',
  'after'
]
const UNIT_LABELS: Record<RepeatUnit, string> = { d: '日', w: '週', m: 'か月' }
const NTH_OPTIONS: { value: NthWeek; label: string }[] = [
  { value: 1, label: '第1' },
  { value: 2, label: '第2' },
  { value: 3, label: '第3' },
  { value: 4, label: '第4' },
  { value: 'last', label: '最終' }
]

/** 繰り返しを当てはめる日（なければ今日）の年月日と曜日 */
function baseDate(anchor: string | null): { month: number; day: number; weekday: number } {
  const d = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? new Date(`${anchor}T00:00:00Z`) : null
  const date = d && !Number.isNaN(d.getTime()) ? d : new Date()
  return d
    ? { month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() }
    : { month: date.getMonth() + 1, day: date.getDate(), weekday: date.getDay() }
}

/** 種類を選んだときの初期値（着手日、なければ期限の曜日や日に合わせる） */
function defaultRule(kind: Kind, anchor: string | null): RepeatRule | null {
  const base = baseDate(anchor)
  switch (kind) {
    case 'daily':
    case 'weekdays':
    case 'monthly-end':
      return { kind }
    case 'weekly':
      return { kind, days: [base.weekday] }
    case 'monthly-day':
      return { kind, day: base.day }
    case 'monthly-nth': {
      const n = Math.ceil(base.day / 7)
      return { kind, n: n <= 4 ? (n as NthWeek) : 'last', weekday: base.weekday }
    }
    case 'yearly':
      return { kind, month: base.month, day: base.day }
    case 'every':
    case 'after':
      return { kind, n: 1, unit: 'w' }
    default:
      return null
  }
}

/** 1〜max の整数として読めれば返す */
function intIn(text: string, max: number): number | null {
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= max ? n : null
}

/** 数字の入力欄。入力中は手元に持ち、正しい数になったときだけ渡す */
function NumberField({
  value,
  max,
  label,
  onCommit
}: {
  value: number
  max: number
  label: string
  onCommit: (n: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  const [last, setLast] = useState(value)
  if (last !== value) {
    setLast(value)
    setDraft(String(value))
  }
  return (
    <input
      className="repeat-number"
      type="number"
      min={1}
      max={max}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = intIn(e.target.value, max)
        if (n !== null && n !== value) onCommit(n)
      }}
      onBlur={() => setDraft(String(value))}
    />
  )
}

/** 書式を直接書く欄。確定（フォーカスが外れる・Enter）したときだけ渡す */
function RawField({
  value,
  onCommit
}: {
  value: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [last, setLast] = useState(value)
  if (last !== value) {
    setLast(value)
    setDraft(value)
  }
  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className="repeat-raw"
      aria-label="繰り返しの書式"
      title="RULES.md の書き方（例：weekly:mon,thu、monthly:2tue、every:2w）"
      placeholder="例：weekly:mon"
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

function RepeatInput({ value, anchor, onChange }: Props): React.JSX.Element {
  const rule = parseRepeat(value)
  const kind: Kind = value === null ? 'none' : rule ? rule.kind : 'custom'
  const set = (next: RepeatRule | null): void => onChange(next ? formatRepeat(next) : null)
  /** 書式を直接書く欄を開いているか。普段はプルダウンで選んでもらうので隠す */
  const [rawOpen, setRawOpen] = useState(false)
  // プルダウンで表せない値（AI や手で書いた読めない書式）のときは、直す欄を出したままにする
  const showRaw = rawOpen || kind === 'custom'

  return (
    <div className="repeat-input">
      <div className="repeat-row">
        <select
          aria-label="繰り返しの種類"
          value={kind}
          onChange={(e) => set(defaultRule(e.target.value as Kind, anchor))}
        >
          {kind === 'custom' && <option value="custom">{KIND_LABELS.custom}</option>}
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>

        {rule?.kind === 'weekly' && (
          <span className="repeat-weekdays" role="group" aria-label="曜日">
            {WEEKDAY_LABELS.map((label, day) => {
              const on = rule.days.includes(day)
              return (
                <button
                  key={label}
                  type="button"
                  className={on ? 'chip on' : 'chip'}
                  aria-pressed={on}
                  onClick={() => {
                    const days = on ? rule.days.filter((d) => d !== day) : [...rule.days, day]
                    // 曜日を全部外したら、その曜日だけは残す（毎週の繰り返しには曜日が要る）
                    if (days.length > 0) set({ ...rule, days: days.sort((a, b) => a - b) })
                  }}
                >
                  {label}
                </button>
              )
            })}
          </span>
        )}

        {rule?.kind === 'monthly-day' && (
          <span className="repeat-parts">
            <NumberField
              value={rule.day}
              max={31}
              label="日"
              onCommit={(day) => set({ ...rule, day })}
            />
            日
          </span>
        )}

        {rule?.kind === 'monthly-nth' && (
          <span className="repeat-parts">
            <select
              aria-label="第何週"
              value={String(rule.n)}
              onChange={(e) =>
                set({
                  ...rule,
                  n: e.target.value === 'last' ? 'last' : (Number(e.target.value) as NthWeek)
                })
              }
            >
              {NTH_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label="曜日"
              value={rule.weekday}
              onChange={(e) => set({ ...rule, weekday: Number(e.target.value) })}
            >
              {WEEKDAY_LABELS.map((label, day) => (
                <option key={label} value={day}>
                  {label}曜
                </option>
              ))}
            </select>
          </span>
        )}

        {rule?.kind === 'yearly' && (
          <span className="repeat-parts">
            <select
              aria-label="月"
              value={rule.month}
              onChange={(e) => {
                const month = Number(e.target.value)
                // 選んだ月にない日（4月31日など）は、その月の末日にする
                const max = new Date(Date.UTC(2000, month, 0)).getUTCDate()
                set({ ...rule, month, day: Math.min(rule.day, max) })
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}月
                </option>
              ))}
            </select>
            <NumberField
              value={rule.day}
              max={new Date(Date.UTC(2000, rule.month, 0)).getUTCDate()}
              label="日"
              onCommit={(day) => set({ ...rule, day })}
            />
            日
          </span>
        )}

        {(rule?.kind === 'every' || rule?.kind === 'after') && (
          <span className="repeat-parts">
            <NumberField
              value={rule.n}
              max={MAX_INTERVAL}
              label="間隔"
              onCommit={(n) => set({ ...rule, n })}
            />
            <select
              aria-label="単位"
              value={rule.unit}
              onChange={(e) => set({ ...rule, unit: e.target.value as RepeatUnit })}
            >
              {(['d', 'w', 'm'] as const).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
            {rule.kind === 'every' ? 'ごと' : '後'}
          </span>
        )}
      </div>

      <div className="repeat-row">
        <span className={kind === 'custom' ? 'repeat-summary warn' : 'repeat-summary'}>
          {kind === 'custom'
            ? 'プルダウンで表せない書き方です（RULES.md と違うので、次回分を作れません）。下の欄で直すか、プルダウンで選び直してください'
            : rule
              ? describeRepeat(rule)
              : '繰り返さない'}
        </span>
        {kind !== 'custom' && (
          <button
            type="button"
            className="link repeat-raw-toggle"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((o) => !o)}
          >
            {rawOpen ? '書式の欄を閉じる' : '書式で書く'}
          </button>
        )}
      </div>
      {showRaw && (
        <div className="repeat-row">
          <span className="repeat-raw-label">RULES.md の書き方</span>
          <RawField value={value ?? ''} onCommit={(v) => onChange(v.trim() || null)} />
        </div>
      )}
    </div>
  )
}

export default RepeatInput
