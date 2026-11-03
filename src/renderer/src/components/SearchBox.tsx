// 画面の上の検索欄。チケット・ノート・アーカイブをタイトルと本文から探す。Ctrl+K で入る
// 探すのは裏方で、探すたびにファイルを読む。絞り込み（タグなど）は検索の結果には効かせない

import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchKind } from '../../../shared/search'

interface Props {
  /** 当たったものを開く。term は当たった箇所まで動かすときに探す語 */
  onOpen: (fileName: string, term: string) => void
}

/** 打つのが止まってから探すまでの時間 */
const SEARCH_DELAY_MS = 200

const KIND_LABELS: Record<SearchKind, string> = {
  ticket: 'チケット',
  note: 'ノート',
  archive: 'アーカイブ'
}

function SearchBox({ onOpen }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [includeTranscript, setIncludeTranscript] = useState(false)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /** 古い問い合わせの答えで新しい結果を上書きしないための番号 */
  const requestRef = useRef(0)

  // Ctrl+K（mac は ⌘K）で検索欄に入る
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 外をクリックしたら閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // 打つのが止まったら探す
  useEffect(() => {
    const id = ++requestRef.current
    if (query.trim() === '') return
    const timer = setTimeout(() => {
      window.api
        .search(query, { includeTranscript })
        .then((result) => {
          if (requestRef.current !== id) return
          setHits(result)
          setActive(0)
          setError(null)
        })
        .catch((e: Error) => {
          if (requestRef.current === id) setError(e.message)
        })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, includeTranscript])

  const pick = (hit: SearchHit): void => {
    setOpen(false)
    onOpen(hit.fileName, hit.term)
  }

  return (
    <div className="search-box" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="検索（Ctrl+K）"
        aria-label="チケット・ノートを探す"
        onChange={(e) => {
          setQuery(e.target.value)
          // 前の語の結果を出したままにしない（新しい結果が届くまで「探しています…」）
          setHits(null)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // 日本語入力の変換中のキーは、変換の操作なので何もしない
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          const list = hits ?? []
          if (e.key === 'ArrowDown' && list.length > 0) {
            e.preventDefault()
            setActive((i) => (i + 1) % list.length)
          } else if (e.key === 'ArrowUp' && list.length > 0) {
            e.preventDefault()
            setActive((i) => (i - 1 + list.length) % list.length)
          } else if (e.key === 'Enter' && list[active]) {
            e.preventDefault()
            pick(list[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      {open && query.trim() !== '' && (
        <div className="search-panel" role="listbox" aria-label="検索の結果">
          <label className="check search-option">
            <input
              type="checkbox"
              checked={includeTranscript}
              onChange={(e) => setIncludeTranscript(e.target.checked)}
            />
            ノートの文字起こしも探す
          </label>
          {error && <p className="dialog-error">{error}</p>}
          {hits === null && !error && <p className="search-empty">探しています…</p>}
          {hits?.length === 0 && <p className="search-empty">見つかりません</p>}
          {hits && hits.length > 0 && (
            <ul>
              {hits.map((hit, i) => (
                <li
                  key={hit.fileName}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : ''}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(hit)
                  }}
                >
                  <span className="search-head">
                    <span className={`search-kind kind-${hit.kind}`}>{KIND_LABELS[hit.kind]}</span>
                    <span className={hit.title ? 'search-title' : 'search-title untitled'}>
                      {hit.title || '（タイトルなし）'}
                    </span>
                  </span>
                  {hit.snippet && <span className="search-snippet">{hit.snippet}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchBox
