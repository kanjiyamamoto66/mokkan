// カレンダーとガントの凡例。「?」ボタンを押したときだけ出す（色の意味の決まりは docs/spec.md「色の意味」）

import { useEffect, useRef, useState } from 'react'
import { STATUSES, type Priority } from '../../../shared/ticket'
import type { TagColors } from '../../../shared/tagColor'
import { PRIORITY_LABELS, STATUS_LABELS } from '../labels'
import { tagStyle } from '../tagStyle'

const PRIORITIES: Priority[] = [1, 2, 3]

interface Props {
  /** 凡例に出すタグ */
  tags: string[]
  tagColors: TagColors
}

function Legend({ tags, tagColors }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 外をクリックするか Esc で閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="legend" ref={rootRef}>
      <button
        type="button"
        className={open ? 'legend-toggle on' : 'legend-toggle'}
        title="色の意味"
        aria-label="色の意味"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div className="legend-panel" role="dialog" aria-label="色の意味">
          <dl>
            <dt>状態（塗り方）</dt>
            <dd>
              {STATUSES.map((s) => (
                <span key={s} className={`legend-sample status-sample ${s}`}>
                  {STATUS_LABELS[s]}
                </span>
              ))}
            </dd>
            <dt>優先度（小さな丸）</dt>
            <dd>
              {PRIORITIES.map((p) => (
                <span key={p} className="legend-sample">
                  <span className={`priority-dot p${p}`} />
                  {PRIORITY_LABELS[p]}
                </span>
              ))}
              <small>カレンダーは「高」だけ</small>
            </dd>
            <dt>期限切れ</dt>
            <dd>
              <span className="legend-sample status-sample todo overdue">
                <span className="overdue-mark">!</span>期限切れ
              </span>
              <small>赤い枠と「!」。塗りは状態のまま</small>
            </dd>
            <dt>選んでいるチケット</dt>
            <dd>
              <span className="legend-sample status-sample todo selected">選択中</span>
            </dd>
            <dt>タグ（左の線。最初のタグの色）</dt>
            <dd>
              {tags.length === 0 && <small>タグはまだありません</small>}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="legend-sample tag-colored"
                  style={tagStyle(tag, tagColors)}
                >
                  <span className="tag-swatch" />
                  {tag}
                </span>
              ))}
              <small>色はタグの入力欄の色の印から選べます</small>
            </dd>
          </dl>
        </div>
      )}
    </div>
  )
}

export default Legend
