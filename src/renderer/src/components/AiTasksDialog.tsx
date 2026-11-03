// ノートの画面から、AI（パソコンの Claude Code）にタスクの候補を出してもらう窓
// 1. 送る前に確かめる（文字起こしを送るかも選ぶ） 2. 候補を出してもらう 3. 人が選んで直す 4. 選んだものを作る
// 候補を出すまでは何も作らない（RULES.md「議事メモからタスクを起こす」の、人が選ぶ決まり）

import { useEffect, useState } from 'react'
import type { AiCandidate, AiSuggestResult, FromNoteRequest } from '../../../shared/api'

interface Props {
  /** ノートの本文の文字数（送る量の目安） */
  bodyLength: number
  /** 「文字起こし」の節があるか */
  hasTranscript: boolean
  onSuggest: (includeTranscript: boolean) => Promise<AiSuggestResult>
  onCancelSuggest: () => void
  /** 1件作る。作れなかったら理由を返す */
  onCreate: (title: string, request: FromNoteRequest) => Promise<string | null>
  onClose: () => void
}

/** 画面で直している候補 */
interface Draft extends AiCandidate {
  chosen: boolean
  /** 担当者を「、」でつないだ入力中の文字 */
  assigneeText: string
}

type Step =
  | { kind: 'confirm' }
  | { kind: 'running' }
  | { kind: 'review'; truncated: boolean }
  | { kind: 'creating'; done: number; total: number }
  | { kind: 'finished'; created: number; errors: string[] }

function AiTasksDialog({
  bodyLength,
  hasTranscript,
  onSuggest,
  onCancelSuggest,
  onCreate,
  onClose
}: Props): React.JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'confirm' })
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)

  // 作っている途中は閉じない（Esc で閉じるのは、それ以外のとき）
  const busy = step.kind === 'running' || step.kind === 'creating'
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const suggest = async (): Promise<void> => {
    setError(null)
    setStep({ kind: 'running' })
    const result = await onSuggest(includeTranscript)
    if (result.status === 'not-installed') {
      setError(
        'Claude Code（claude コマンド）が見つかりません。Claude Code をインストールしてログインしてから、もう一度試してください。'
      )
      setStep({ kind: 'confirm' })
      return
    }
    if (result.status === 'error') {
      setError(`候補を出せませんでした：${result.message}`)
      setStep({ kind: 'confirm' })
      return
    }
    setDrafts(
      result.candidates.map((c) => ({
        ...c,
        // 迷っている候補は、初めは選ばないでおく
        chosen: c.doubt === null,
        assigneeText: c.assignees.join('、')
      }))
    )
    setStep({ kind: 'review', truncated: result.truncated })
  }

  const update = (index: number, patch: Partial<Draft>): void => {
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  const create = async (): Promise<void> => {
    const chosen = drafts.filter((d) => d.chosen && d.title.trim() !== '')
    const errors: string[] = []
    let created = 0
    for (const [i, d] of chosen.entries()) {
      setStep({ kind: 'creating', done: i, total: chosen.length })
      const reason = await onCreate(d.title.trim(), {
        homeworkItem: d.homework,
        assignee: d.assigneeText
          .split(/[、,，・]/)
          .map((n) => n.trim())
          .filter((n) => n !== ''),
        due: d.due
      })
      if (reason) errors.push(`「${d.title}」：${reason}`)
      else created++
    }
    setStep({ kind: 'finished', created, errors })
  }

  const chosenCount = drafts.filter((d) => d.chosen && d.title.trim() !== '').length

  return (
    <div className="dialog-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="dialog ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="ai-dialog-title">AI でタスクを起こす</h2>

        {step.kind === 'confirm' && (
          <>
            <p className="dialog-note">
              このノートを AI（このパソコンの Claude Code）に送り、タスクの候補を出してもらいます。
              候補を見て選んでから作ります。送るだけでは何も作りません。
            </p>
            <p className="dialog-note">
              文字起こしには、社外の人の発言や秘密の話が入っていることがあります。送ってよいかを確かめてください。
            </p>
            {hasTranscript && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeTranscript}
                  onChange={(e) => setIncludeTranscript(e.target.checked)}
                />
                文字起こしも送る（外すと、要点・決定事項・宿題などだけを送ります）
              </label>
            )}
            <p className="dialog-note">本文は約 {bodyLength.toLocaleString()} 文字です。</p>
            {error && <p className="dialog-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={onClose}>
                やめる
              </button>
              <button type="button" className="primary" onClick={() => void suggest()}>
                送って候補を出してもらう
              </button>
            </div>
          </>
        )}

        {step.kind === 'running' && (
          <>
            <p className="dialog-note">AI が候補を考えています…（1分ほどかかることがあります）</p>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={onCancelSuggest}>
                止める
              </button>
            </div>
          </>
        )}

        {step.kind === 'review' && (
          <>
            {step.truncated && (
              <p className="dialog-error">ノートが長いので、途中までを送りました。</p>
            )}
            {drafts.length === 0 ? (
              <p className="dialog-note">
                候補はありませんでした（すでに作ったチケットは候補から外しています）。
              </p>
            ) : (
              <p className="dialog-note">
                作るものを選び、必要なら直してください。作ると「宿題」に「→
                チケットへのリンク」を書き戻します。
              </p>
            )}
            <ul className="ai-candidates">
              {drafts.map((d, i) => (
                <li key={i} className={d.chosen ? 'chosen' : ''}>
                  <label className="ai-choose">
                    <input
                      type="checkbox"
                      checked={d.chosen}
                      aria-label={`「${d.title}」を作る`}
                      onChange={(e) => update(i, { chosen: e.target.checked })}
                    />
                  </label>
                  <div className="ai-fields">
                    <input
                      className="ai-title"
                      value={d.title}
                      maxLength={200}
                      aria-label="タイトル"
                      onChange={(e) => update(i, { title: e.target.value })}
                    />
                    <div className="ai-row">
                      <label>
                        担当
                        <input
                          value={d.assigneeText}
                          placeholder="なし"
                          aria-label="担当者（「、」で区切る）"
                          onChange={(e) => update(i, { assigneeText: e.target.value })}
                        />
                      </label>
                      <label>
                        期限
                        <input
                          type="date"
                          value={d.due ?? ''}
                          aria-label="期限"
                          onChange={(e) => update(i, { due: e.target.value || null })}
                        />
                      </label>
                    </div>
                    {d.evidence && <small className="ai-evidence">根拠：{d.evidence}</small>}
                    {d.homework && <small className="ai-evidence">宿題の行：{d.homework}</small>}
                    {d.doubt && <small className="ai-doubt">迷い：{d.doubt}</small>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={onClose}>
                作らずに閉じる
              </button>
              <button
                type="button"
                className="primary"
                disabled={chosenCount === 0}
                onClick={() => void create()}
              >
                選んだ {chosenCount} 件を作る
              </button>
            </div>
          </>
        )}

        {step.kind === 'creating' && (
          <p className="dialog-note">
            作っています…（{step.done + 1} / {step.total}）
          </p>
        )}

        {step.kind === 'finished' && (
          <>
            <p className="dialog-note">{step.created} 件のチケットを作りました。</p>
            {step.errors.map((e) => (
              <p key={e} className="dialog-error">
                {e}
              </p>
            ))}
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={onClose}>
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AiTasksDialog
