// 一覧（カレンダー・ガント）と編集画面の境目。ドラッグか左右の矢印キーで編集画面の幅を変え、ダブルクリックで初めの幅に戻す
// 幅は、一覧が下限より狭くならず、編集画面も下限より狭くならない範囲に収める（clampEditorWidth）

import { useEffect, useRef } from 'react'
import { MIN_EDITOR_WIDTH, clampEditorWidth } from '../../../shared/paneWidth'

/** 矢印キー1回で動かす幅 */
const KEY_STEP = 16

interface Props {
  /** 今の編集画面の幅（ドラッグで決めた幅）。初めの幅のままなら null */
  width: number | null
  /** ドラッグ中・キーで動かしたときの幅（画面だけに反映する） */
  onResize: (width: number) => void
  /** 幅を決めたとき（保存する）。null なら初めの幅に戻す */
  onCommit: (width: number | null) => void
}

/** 境目の両隣（一覧と編集画面）の幅 */
function measure(el: HTMLElement): { editor: number; available: number } {
  const main = el.previousElementSibling?.getBoundingClientRect().width ?? 0
  const editor = el.nextElementSibling?.getBoundingClientRect().width ?? MIN_EDITOR_WIDTH
  return { editor, available: main + editor }
}

function PaneSplitter({ width, onResize, onCommit }: Props): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number; available: number } | null>(null)
  const last = useRef<number | null>(null)
  /** 矢印キーで動かしている途中の幅（キーを離したら保存する） */
  const keyWidth = useRef<number | null>(null)

  // ドラッグの途中で編集画面を閉じたとき（境目が消えたとき）も、カーソルと文字の選択を元に戻す
  useEffect(() => () => document.body.classList.remove('pane-resizing'), [])

  return (
    <div
      className="pane-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="一覧と編集画面の境目"
      aria-valuenow={width ?? undefined}
      aria-valuemin={MIN_EDITOR_WIDTH}
      tabIndex={0}
      title="ドラッグで幅を変えます（ダブルクリックで初めの幅に戻す）"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const { editor, available } = measure(e.currentTarget)
        drag.current = { startX: e.clientX, startWidth: editor, available }
        last.current = null
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('pane-resizing')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        // 境目を左に動かすと、右の編集画面が広がる
        const next = clampEditorWidth(d.startWidth - (e.clientX - d.startX), d.available)
        last.current = next
        onResize(next)
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }}
      // 捕捉が外れたとき（pointerup でも pointercancel でも呼ばれる）に片付けて保存する
      onLostPointerCapture={() => {
        if (!drag.current) return
        drag.current = null
        document.body.classList.remove('pane-resizing')
        if (last.current !== null) onCommit(last.current)
      }}
      onDoubleClick={() => onCommit(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const { editor, available } = measure(e.currentTarget)
        const delta = e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP
        const next = clampEditorWidth((keyWidth.current ?? editor) + delta, available)
        keyWidth.current = next
        onResize(next)
      }}
      // 押し続けている間は画面だけを変え、キーを離したときに1回だけ保存する
      onKeyUp={() => {
        if (keyWidth.current === null) return
        onCommit(keyWidth.current)
        keyWidth.current = null
      }}
      onBlur={() => {
        if (keyWidth.current === null) return
        onCommit(keyWidth.current)
        keyWidth.current = null
      }}
    />
  )
}

export default PaneSplitter
