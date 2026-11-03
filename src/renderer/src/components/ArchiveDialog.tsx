// 完了したチケットをまとめてアーカイブする画面（tasks/archive/ に移す。自動では動かさない）

import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_ARCHIVE_DAYS, bulkArchiveTargets } from '../../../shared/archive'
import { addDays } from '../../../shared/schedule'
import type { Ticket } from '../../../shared/ticket'

interface Props {
  tickets: Ticket[]
  today: string
  /** 完了日がこの日以前のものを移す。移した後のキーの対応を返す */
  onArchive: (cutoff: string) => Promise<void>
  onClose: () => void
}

function ArchiveDialog({ tickets, today, onArchive, onClose }: Props): React.JSX.Element {
  const [days, setDays] = useState(String(DEFAULT_ARCHIVE_DAYS))
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const valid = /^\d{1,4}$/.test(days)
  const cutoff = valid ? addDays(today, -Number(days)) : null
  const targets = useMemo(
    () => (cutoff ? bulkArchiveTargets(tickets, cutoff) : []),
    [tickets, cutoff]
  )

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = async (): Promise<void> => {
    if (!cutoff || targets.length === 0) return
    setRunning(true)
    setError(null)
    try {
      await onArchive(cutoff)
      onClose()
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="archive-title">まとめてアーカイブ</h2>
        <p className="dialog-note">
          完了したチケットを tasks/archive/
          に移します。親子はIDでつながっているので切れません。未完了の子チケットがあるものは移しません。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <label className="dialog-field">
            <span>完了してから何日たったものを移しますか</span>
            <span className="dialog-inline">
              <input
                ref={inputRef}
                type="number"
                min={0}
                max={9999}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              日以上（{cutoff ? `${cutoff} 以前に完了` : '日数を入れてください'}）
            </span>
          </label>
          <p className="dialog-note">対象：{targets.length} 件（子チケットを含む）</p>
          {error && <p className="dialog-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="primary" disabled={running || targets.length === 0}>
              {targets.length} 件をアーカイブ
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ArchiveDialog
