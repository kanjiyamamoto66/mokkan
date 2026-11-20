// ノートの点検の結果（ノートの画面で「点検」を押したときに、ノートの一覧の代わりに出す）
// 開いている間はファイルが変わるたびに点検し直す。結果はファイルに書かず、「md でコピー」でクリップボードに入れるだけ

import { useCallback, useEffect, useRef, useState } from 'react'
import { LINT_KINDS, LINT_KIND_HINTS, LINT_KIND_LABELS, type LintItem } from '../../../shared/lint'

/** ファイルが変わってから点検し直すまでの時間（続けて変わったときに何度も読まないように） */
const RELINT_DELAY_MS = 500

interface Props {
  /** ファイルが変わるたびに変わる値（AppState など）。変わったら点検し直す */
  stamp: unknown
  onOpen: (fileName: string) => void
  /** 入口がないフォルダを、左の木で選ぶ */
  onSelectFolder: (folder: string) => void
  onClose: () => void
}

function errorText(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function NoteLintPanel({ stamp, onOpen, onSelectFolder, onClose }: Props): React.JSX.Element {
  const [items, setItems] = useState<LintItem[] | null>(null)
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)

  const lint = useCallback(async () => {
    try {
      setItems(await window.api.lint())
    } catch (e) {
      setMessage({ kind: 'error', text: `点検できませんでした：${errorText(e)}` })
    }
  }, [])

  // 開いたときはすぐ、その後はファイルが変わってから少し待って点検し直す
  const firstRef = useRef(true)
  useEffect(() => {
    const delay = firstRef.current ? 0 : RELINT_DELAY_MS
    firstRef.current = false
    const timer = setTimeout(() => void lint(), delay)
    return () => clearTimeout(timer)
  }, [stamp, lint])

  const copy = async (): Promise<void> => {
    try {
      const count = await window.api.copyLintReport()
      setMessage({
        kind: 'info',
        text: `点検の結果（${count} 件）を md でコピーしました。AI に貼って直してもらえます。`
      })
    } catch (e) {
      setMessage({ kind: 'error', text: `コピーできませんでした：${errorText(e)}` })
    }
  }

  const fix = async (item: LintItem): Promise<void> => {
    if (!item.fileName || !item.href) return
    const key = `${item.fileName}\n${item.href}`
    setFixing(key)
    setMessage(null)
    try {
      await window.api.fixLink(item.fileName, item.href)
      await lint()
    } catch (e) {
      setMessage({ kind: 'error', text: `直せませんでした：${errorText(e)}` })
    } finally {
      setFixing(null)
    }
  }

  return (
    <section className="lint">
      <div className="lint-header">
        <h2>ノートの点検</h2>
        <span className="count">{items === null ? '点検中…' : `${items.length} 件`}</span>
        <span className="spacer" />
        <button
          className="ghost"
          onClick={() => void copy()}
          disabled={items === null}
          title="結果を md の箇条書きにしてクリップボードに入れます（ファイルには書きません）"
        >
          md でコピー
        </button>
        <button className="ghost" onClick={onClose}>
          一覧に戻る
        </button>
      </div>
      <p className="lint-note">
        手入れが要りそうなところを知らせるだけで、ファイルは書き換えません（「直す」を押したリンクを除く）。結果はファイルに残しません。
      </p>
      {message && (
        <div
          className={`notice ${message.kind}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{message.text}</p>
        </div>
      )}
      {items !== null && items.length === 0 && (
        <div className="empty">見つかったものはありません。</div>
      )}
      {items !== null &&
        LINT_KINDS.map((kind) => {
          const group = items.filter((i) => i.kind === kind)
          if (group.length === 0) return null
          return (
            <section key={kind} className={`lint-group lint-${kind}`}>
              <h3>
                {LINT_KIND_LABELS[kind]}
                <span className="count">{group.length}</span>
              </h3>
              <p className="hint">{LINT_KIND_HINTS[kind]}</p>
              <ul>
                {group.map((item, i) => (
                  <li key={`${item.fileName ?? item.title}-${item.href ?? ''}-${i}`}>
                    {item.fileName ? (
                      <button
                        className="link title"
                        onClick={() => onOpen(item.fileName!)}
                        title={item.fileName}
                      >
                        {item.title}
                      </button>
                    ) : (
                      <button
                        className="link title"
                        onClick={() => onSelectFolder(item.title)}
                        title="左の木でこのフォルダを選ぶ"
                      >
                        notes/{item.title}/
                      </button>
                    )}
                    {item.line !== null && <span className="line">{item.line}行目</span>}
                    <span className="detail">{item.detail}</span>
                    {item.kind === 'shifted-link' && (
                      <button
                        className="fix"
                        disabled={fixing !== null}
                        onClick={() => void fix(item)}
                        title="このリンクの相対パスを、リンク先の今のファイルに書き換えます（ほかは変えません）"
                      >
                        {fixing === `${item.fileName}\n${item.href}` ? '直しています…' : '直す'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
    </section>
  )
}

export default NoteLintPanel
