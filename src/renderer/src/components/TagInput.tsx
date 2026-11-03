// タグの入力欄。付けたタグをチップで並べ、入力した文字で既存のタグを絞り込んで候補に出す
// 候補にない新しいタグも、そのまま入力して Enter（または半角の「,」）で付けられる
// 日本語入力（IME）の変換中は、Enter や区切りの文字でタグを確定しない

import { useId, useMemo, useRef, useState } from 'react'
import { tagHue, type TagColors } from '../../../shared/tagColor'
import { tagStyle } from '../tagStyle'
import TagColorPicker from './TagColorPicker'

interface Props {
  tags: string[]
  /** 候補にするタグ（全チケットのタグ） */
  suggestions: string[]
  onChange: (tags: string[]) => void
  /** タグの色（TAGS.md）。渡すと、チップにタグの色を付け、色の印から色を選べるようにする */
  colors?: TagColors
  /** タグの色を選んだとき（null は指定を外す） */
  onColorChange?: (tag: string, hue: number | null) => void
  /** 入力欄の名前（読み上げ用）。担当者の欄にも使い回す */
  label?: string
  /** 何も入っていないときの例 */
  placeholder?: string
}

/**
 * タグの区切り（半角のカンマだけ）。日本語入力の「、」は、変換を確定した時点で区切られて
 * 後ろの文字が入力欄に残り使いにくいので、区切りにしない（タグの中の文字として扱う）
 */
const SEPARATORS = /,/
/** 一度に出す候補の数 */
const MAX_SUGGESTIONS = 8

function TagInput({
  tags,
  suggestions,
  onChange,
  colors,
  onColorChange,
  label = 'タグ',
  placeholder = '仕事, A社'
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  /** 色を選んでいるタグ */
  const [picking, setPicking] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  /** 矢印キーで選んでいる候補。-1 は選んでいない（Enter で入力した文字をそのまま付ける） */
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 日本語入力の変換中か（変換途中の読みをタグにしないため） */
  const composingRef = useRef(false)
  const listId = useId()

  const candidates = useMemo(() => {
    const query = draft.trim().toLowerCase()
    return suggestions
      .filter((s) => !tags.includes(s) && (query === '' || s.toLowerCase().includes(query)))
      .slice(0, MAX_SUGGESTIONS)
  }, [draft, suggestions, tags])

  /** タグを足す。空・重複は除く。足した後に残す入力中の文字を rest で渡す */
  const add = (values: string[], rest = ''): void => {
    const next = [...tags]
    for (const value of values.map((v) => v.trim())) {
      if (value !== '' && !next.includes(value)) next.push(value)
    }
    setDraft(rest)
    setActive(-1)
    if (next.length !== tags.length) onChange(next)
  }

  const remove = (tag: string): void => {
    onChange(tags.filter((t) => t !== tag))
    inputRef.current?.focus()
  }

  /** 入力に区切りの文字があれば、その前までをタグにする */
  const splitDraft = (value: string): void => {
    if (!SEPARATORS.test(value)) {
      setDraft(value)
      return
    }
    const parts = value.split(SEPARATORS)
    const rest = parts.pop() ?? ''
    add(parts, rest)
  }

  return (
    <div className="tag-input" onClick={() => inputRef.current?.focus()}>
      {tags.map((tag) => (
        <span
          key={tag}
          className={colors ? 'tag-chip tag-colored' : 'tag-chip'}
          style={colors ? tagStyle(tag, colors) : undefined}
        >
          {colors && onColorChange && (
            <button
              type="button"
              className="tag-color-button"
              aria-label={`タグ「${tag}」の色を選ぶ`}
              title="色を選ぶ"
              onClick={(e) => {
                e.stopPropagation()
                setPicking((p) => (p === tag ? null : tag))
              }}
            >
              <span className="tag-swatch" />
            </button>
          )}
          {tag}
          <button
            type="button"
            className="remove"
            aria-label={`${label}「${tag}」を外す`}
            onClick={(e) => {
              e.stopPropagation()
              remove(tag)
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        role="combobox"
        aria-label={label}
        aria-expanded={open && candidates.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={tags.length === 0 ? placeholder : ''}
        onChange={(e) => {
          // 変換中は区切らない（変換を確定したときに compositionend で区切る）
          if ((e.nativeEvent as InputEvent).isComposing) setDraft(e.target.value)
          else splitDraft(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          splitDraft(e.currentTarget.value)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // フォーカスが外れたら、入力中の文字もタグにする
          // ただし変換中に外れたときは、変換途中の読みなのでタグにしない
          if (!composingRef.current && draft.trim() !== '') add([draft])
          setOpen(false)
        }}
        onKeyDown={(e) => {
          // 日本語入力の変換中のキーは、変換の操作なので何もしない
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'ArrowDown' && candidates.length > 0) {
            e.preventDefault()
            setOpen(true)
            setActive((i) => (i + 1) % candidates.length)
          } else if (e.key === 'ArrowUp' && candidates.length > 0) {
            e.preventDefault()
            setOpen(true)
            setActive((i) => (i <= 0 ? candidates.length - 1 : i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && active >= 0 && candidates[active]) add([candidates[active]])
            else add([draft])
          } else if (e.key === 'Escape') {
            setOpen(false)
            setActive(-1)
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
      />
      {open && candidates.length > 0 && (
        <ul className="tag-suggestions" id={listId} role="listbox">
          {candidates.map((c, i) => (
            <li
              key={c}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              // クリックで入力欄のフォーカスが外れないようにする
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                add([c])
              }}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
      {picking && colors && onColorChange && tags.includes(picking) && (
        <TagColorPicker
          tag={picking}
          hue={tagHue(picking, colors)}
          chosen={colors[picking] !== undefined}
          onPick={(hue) => onColorChange(picking, hue)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

export default TagInput
