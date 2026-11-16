// 編集画面の「このノート（チケット）へのリンク」。本文の md のリンクと ID で、このファイルを指しているもの
// 本文は持ち続けない決まりなので、開いたときとファイルが変わったときに裏方がファイルを読んで数える
// 編集画面はファイルごとに作り直す（TicketEditor の key）ので、fileName は変わらない

import { useEffect, useRef, useState } from 'react'
import type { Backlink } from '../../../shared/lint'

/** ファイルが変わってから数え直すまでの時間（入力中の保存のたびに読まないように） */
const RELOAD_DELAY_MS = 800

interface Props {
  fileName: string
  isNote: boolean
  /** ファイルが変わるたびに変わる値。変わったら数え直す */
  stamp: unknown
  onOpen: (fileName: string) => void
}

function Backlinks({ fileName, isNote, stamp, onOpen }: Props): React.JSX.Element | null {
  const [links, setLinks] = useState<Backlink[] | null>(null)

  // 開いたときはすぐ、その後はファイルが変わってから少し待って数え直す
  const firstRef = useRef(true)
  useEffect(() => {
    let cancelled = false
    const delay = firstRef.current ? 0 : RELOAD_DELAY_MS
    firstRef.current = false
    const timer = setTimeout(() => {
      window.api
        .backlinks(fileName)
        .then((list) => {
          if (!cancelled) setLinks(list)
        })
        .catch((e) => console.error('[mokkan] このファイルへのリンクを数えられませんでした', e))
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fileName, stamp])

  if (links === null) return null
  return (
    <div
      className="backlinks"
      title="本文に、このファイルへのリンクか ID を書いているチケット・ノート"
    >
      <span className="label">{isNote ? 'このノートへのリンク' : 'このチケットへのリンク'}</span>
      {links.length === 0 ? (
        <span className="none">なし</span>
      ) : (
        links.map((l) => (
          <button
            key={l.fileName}
            className="link"
            onClick={() => onOpen(l.fileName)}
            title={l.fileName}
          >
            {l.title || '（タイトルなし）'}
          </button>
        ))
      )}
    </div>
  )
}

export default Backlinks
