// 画面の右上の「＋ 新規」ボタンと、テンプレートを選ぶ ▼（上の帯が狭いときは「＋」のアイコンだけ。名前は title と aria-label）
// ボタン（と Ctrl+N）は前回選んだテンプレートで作る。▼ で選ぶと、それで作り、次からの既定にする

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { keyLabel } from '../keys'

interface Props {
  /** ボタンの文字（「新規」「新規ノート」）。前に ＋ のアイコンを付ける。上の帯が狭いときはアイコンだけにする */
  label: string
  disabled: boolean
  /** 今の既定のテンプレート。null なら標準 */
  choice: string | null
  /** 選べるテンプレートの名前（標準のほか） */
  templates: string[]
  /** ▼ を開いたとき（テンプレートの一覧を読み直す） */
  onOpenMenu: () => void
  /** 作る。template は選んだテンプレート（ボタンを押したときは choice） */
  onCreate: (template: string | null) => void
}

function NewButton({
  label,
  disabled,
  choice,
  templates,
  onOpenMenu,
  onCreate
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 外をクリックするか Esc で閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
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

  const pick = (template: string | null): void => {
    setOpen(false)
    onCreate(template)
  }

  return (
    <div className="new-button" ref={ref}>
      <button
        className="primary new-main with-icon shrink-3"
        disabled={disabled}
        onClick={() => onCreate(choice)}
        title={`${label}：テンプレート「${choice ?? '標準'}」で作ります（${keyLabel('Mod+N')}）`}
        aria-label={label}
      >
        <Plus className="icon" aria-hidden="true" />
        <span className="btn-label">
          {label}
          {choice && <span className="new-choice">（{choice}）</span>}
        </span>
        <kbd>{keyLabel('Mod+N')}</kbd>
      </button>
      <button
        className="primary new-menu"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="テンプレートを選んで作る"
        title="テンプレートを選んで作る"
        onClick={() => {
          if (!open) onOpenMenu()
          setOpen(!open)
        }}
      >
        ▾
      </button>
      {open && (
        <ul className="new-templates" role="menu">
          {[null, ...templates].map((t) => (
            <li key={t ?? ''} role="none">
              <button
                role="menuitem"
                className={t === choice ? 'current' : ''}
                onClick={() => pick(t)}
              >
                {t ?? '標準'}
              </button>
            </li>
          ))}
          <li className="new-templates-note" role="none">
            テンプレートは tasks/templates/ に置きます
          </li>
        </ul>
      )}
    </div>
  )
}

export default NewButton
