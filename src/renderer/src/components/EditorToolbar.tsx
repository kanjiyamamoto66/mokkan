// 本文エディタの上のツールバー。カーソル位置の書式に合わせて、ボタンを押された状態で表示する
// 標準の md で書けるものだけを置く（独自記法は出さない）。まとまりごとに区切り線で分け、狭い幅では折り返す

import { useEffect, useRef, useState } from 'react'
import type {
  CommandAction,
  FormatAction,
  TableAction,
  ToolbarAction,
  ToolbarState
} from '../editor/toolbar'

interface Props {
  state: ToolbarState
  disabled?: boolean
  onAction: (action: ToolbarAction) => void
  /** 見出しの段を選んだとき（0 は本文） */
  onHeading: (level: number) => void
  /** リンクの URL を決めたとき（空なら外す） */
  onLink: (href: string) => void
}

interface ButtonDef<A> {
  action: A
  label: string
  title: string
  className?: string
}

const TEXT_BUTTONS: ButtonDef<FormatAction>[] = [
  { action: 'strong', label: 'B', title: '太字（Ctrl+B）', className: 'strong' },
  { action: 'emphasis', label: 'I', title: '斜体（Ctrl+I）', className: 'emphasis' },
  { action: 'strike', label: 'S', title: '取り消し線（Ctrl+Alt+X）', className: 'strike' },
  { action: 'inlineCode', label: '</>', title: 'インラインコード（Ctrl+E）', className: 'code' }
]

const LIST_BUTTONS: ButtonDef<FormatAction>[] = [
  { action: 'bullet', label: '• リスト', title: '箇条書き（Ctrl+Alt+8）' },
  { action: 'ordered', label: '1. リスト', title: '番号付きリスト（Ctrl+Alt+7）' },
  { action: 'task', label: '☑ チェック', title: 'チェックボックス' }
]

const INDENT_BUTTONS: ButtonDef<CommandAction>[] = [
  { action: 'indent', label: '→ 字下げ', title: 'リストの項目を字下げする（Tab）' },
  { action: 'outdent', label: '← 戻す', title: 'リストの字下げを戻す（Shift+Tab）' }
]

const BLOCK_BUTTONS: ButtonDef<FormatAction>[] = [
  { action: 'quote', label: '❝ 引用', title: '引用' },
  { action: 'codeBlock', label: '{ } コード', title: 'コードブロック' }
]

/** 表の中でだけ出す操作 */
const TABLE_BUTTONS: ButtonDef<TableAction>[] = [
  { action: 'rowAbove', label: '↑行', title: '上に行を足す' },
  { action: 'rowBelow', label: '↓行', title: '下に行を足す' },
  { action: 'colLeft', label: '←列', title: '左に列を足す' },
  { action: 'colRight', label: '→列', title: '右に列を足す' },
  { action: 'deleteRow', label: '行を削除', title: 'この行を削除する' },
  { action: 'deleteCol', label: '列を削除', title: 'この列を削除する' }
]

/** 見出しのプルダウンの選択肢。見出し1は本文の先頭のタイトル用なので、普段は出さない */
const HEADING_OPTIONS: { level: number; label: string }[] = [
  { level: 0, label: '本文' },
  { level: 2, label: '見出し2' },
  { level: 3, label: '見出し3' },
  { level: 4, label: '見出し4' }
]

/** 押してもエディタのカーソルと選択範囲が外れないようにする */
const keepSelection = (e: React.MouseEvent): void => e.preventDefault()

function EditorToolbar({ state, disabled, onAction, onHeading, onLink }: Props): React.JSX.Element {
  /** リンクの URL を入れる欄を開いているときの、入力中の URL */
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (linkDraft !== null) linkInputRef.current?.focus()
  }, [linkDraft !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const button = <A extends ToolbarAction>(
    b: ButtonDef<A>,
    pressed: boolean | undefined,
    extraDisabled = false
  ): React.JSX.Element => (
    <button
      key={b.action}
      type="button"
      className={['tool', b.className ?? '', pressed ? 'on' : ''].join(' ')}
      title={b.title}
      aria-label={b.title}
      aria-pressed={pressed}
      disabled={disabled || extraDisabled}
      onMouseDown={keepSelection}
      onClick={() => onAction(b.action)}
    >
      {b.label}
    </button>
  )

  // 本文の途中に見出し1や見出し5・6があるときは、その段もプルダウンに出す（選び直せば2〜4に変えられる）
  const headingOptions = HEADING_OPTIONS.some((o) => o.level === state.heading)
    ? HEADING_OPTIONS
    : [...HEADING_OPTIONS, { level: state.heading, label: `見出し${state.heading}` }].sort(
        (a, b) => a.level - b.level
      )

  const applyLink = (): void => {
    if (linkDraft === null) return
    onLink(linkDraft)
    setLinkDraft(null)
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="書式">
      <div className="tool-group">
        {button(
          { action: 'undo', label: '↶', title: '元に戻す（Ctrl+Z）' },
          undefined,
          !state.canUndo
        )}
        {button(
          { action: 'redo', label: '↷', title: 'やり直す（Ctrl+Y）' },
          undefined,
          !state.canRedo
        )}
      </div>
      <span className="separator" />
      <div className="tool-group">
        <select
          className="tool-select"
          aria-label="段落の種類（見出し）"
          title="段落の種類（見出し）"
          value={state.heading}
          disabled={disabled || state.codeBlock}
          onChange={(e) => onHeading(Number(e.target.value))}
        >
          {headingOptions.map((o) => (
            <option key={o.level} value={o.level}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <span className="separator" />
      <div className="tool-group">{TEXT_BUTTONS.map((b) => button(b, state[b.action]))}</div>
      <span className="separator" />
      <div className="tool-group">
        {LIST_BUTTONS.map((b) => button(b, state[b.action]))}
        {INDENT_BUTTONS.map((b) => button(b, undefined, !state.inList))}
      </div>
      <span className="separator" />
      <div className="tool-group">
        {BLOCK_BUTTONS.map((b) => button(b, state[b.action]))}
        {button({ action: 'hr', label: '― 区切り', title: '区切り線を入れる' }, undefined)}
        <button
          type="button"
          className={['tool', state.link !== null ? 'on' : ''].join(' ')}
          title={state.link !== null ? `リンクを直す（${state.link}）` : 'リンクを入れる'}
          aria-label={state.link !== null ? 'リンクを直す' : 'リンクを入れる'}
          aria-pressed={state.link !== null}
          disabled={disabled || state.codeBlock}
          onMouseDown={keepSelection}
          onClick={() => setLinkDraft(linkDraft === null ? (state.link ?? '') : null)}
        >
          🔗 リンク
        </button>
      </div>
      <span className="separator" />
      <div className="tool-group">
        <button
          type="button"
          className="tool"
          title="表を挿入（3行×3列。見出しの行を含む）"
          aria-label="表を挿入"
          disabled={disabled || state.inTable}
          onMouseDown={keepSelection}
          onClick={() => onAction('table')}
        >
          ▦ 表
        </button>
        {state.inTable &&
          TABLE_BUTTONS.map((b) =>
            // 見出しの行は消せず、その上にも行を足せない（GFM の表は見出しの行が先頭に必要）
            button(
              b,
              undefined,
              state.inHeaderRow && (b.action === 'rowAbove' || b.action === 'deleteRow')
            )
          )}
      </div>
      {linkDraft !== null && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <input
            ref={linkInputRef}
            value={linkDraft}
            placeholder="https://… または ../notes/ファイル名.md"
            aria-label="リンクの URL"
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setLinkDraft(null)
            }}
          />
          <button type="submit" className="primary">
            {linkDraft.trim() === '' && state.link !== null ? '外す' : '決める'}
          </button>
          <button type="button" className="ghost" onClick={() => setLinkDraft(null)}>
            やめる
          </button>
          <small>文字を選んでいればその文字に付けます。空にして決めるとリンクを外します。</small>
        </form>
      )}
    </div>
  )
}

export default EditorToolbar
