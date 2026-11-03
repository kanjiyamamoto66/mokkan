// タグの色を選ぶ小さな窓。色見本（12色）で手早く選び、細かく決めたいときは色相の帯で選ぶ
// 選べるのは色相だけ（鮮やかさと明るさはアプリが一定にする。docs/spec.md「色の意味」）

import { useEffect, useRef, useState } from 'react'
import { SWATCH_HUES } from '../../../shared/tagColor'

interface Props {
  tag: string
  /** 今の色相 */
  hue: number
  /** TAGS.md で色を選んでいるか（false なら名前から決めた色） */
  chosen: boolean
  /** 色相を選んだとき。null なら指定を外す（名前から決める色に戻す） */
  onPick: (hue: number | null) => void
  onClose: () => void
}

function TagColorPicker({ tag, hue, chosen, onPick, onClose }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(hue)
  const rootRef = useRef<HTMLDivElement>(null)

  // 外をクリックするか Esc で閉じる
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /**
   * 帯は動かしている間は手元に持ち、離したときだけ書き込む（ファイルへの書き込みを1回にする）
   * 値が変わっていなければ書かない（Tab で入って離しただけで、自動の色を「選んだ色」として TAGS.md に書かないため）
   */
  const commitDraft = (): void => {
    if (draft !== hue) onPick(draft)
  }

  return (
    <div
      className="tag-color-picker"
      ref={rootRef}
      role="dialog"
      aria-label={`タグ「${tag}」の色`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tag-color-title">
        <span
          className="tag-color-preview tag-colored"
          style={{ '--tag-h': draft } as React.CSSProperties}
        >
          {tag}
        </span>
        <small>{chosen ? '選んだ色' : '名前から決めた色'}</small>
      </div>
      <div className="tag-color-swatches">
        {SWATCH_HUES.map((h) => (
          <button
            key={h}
            type="button"
            className={['tag-color-swatch', 'tag-colored', chosen && h === hue ? 'on' : ''].join(
              ' '
            )}
            style={{ '--tag-h': h } as React.CSSProperties}
            aria-label={`色相 ${h}`}
            title={`色相 ${h}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft(h)
              onPick(h)
            }}
          />
        ))}
      </div>
      <input
        className="tag-color-slider"
        type="range"
        min={0}
        max={359}
        step={1}
        value={draft}
        aria-label="色相"
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commitDraft}
        onKeyUp={commitDraft}
      />
      <div className="tag-color-actions">
        <button
          type="button"
          className="ghost"
          disabled={!chosen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(null)}
        >
          自動の色に戻す
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

export default TagColorPicker
