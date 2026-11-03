// 個人設定の画面（tasks/ の外の settings.json に保存する。共有するデータには書かない）

import { useEffect, useRef, useState } from 'react'
import type { RuleFileStatus } from '../../../shared/api'

interface Props {
  userName: string
  /** tasks フォルダが使える状態か（ルールのファイルの確認を出すか） */
  folderReady: boolean
  onSave: (userName: string) => Promise<void>
  onClose: () => void
}

const RULE_STATE_LABELS: Record<RuleFileStatus['state'], string> = {
  same: '最新',
  different: '原本と違う（古い版、または手で直したもの）',
  missing: 'ない'
}

function errorMessage(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * tasks/ 直下のルールのファイル（RULES.md・テンプレート・CLAUDE.md・AGENTS.md）を、このアプリの原本にする
 * 違うファイルは、今のファイルを OS のごみ箱に移してから置き換える（手で直した内容はごみ箱から戻せる）
 */
function RuleFiles(): React.JSX.Element {
  const [files, setFiles] = useState<RuleFileStatus[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const show = (statuses: RuleFileStatus[]): void => {
    setFiles(statuses)
    setChosen(new Set(statuses.filter((f) => f.state !== 'same').map((f) => f.name)))
  }

  useEffect(() => {
    window.api
      .checkRuleFiles()
      .then(show)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const update = async (): Promise<void> => {
    if (!files) return
    const names = files.filter((f) => chosen.has(f.name)).map((f) => f.name)
    const replaced = files.filter((f) => chosen.has(f.name) && f.state === 'different')
    if (
      replaced.length > 0 &&
      !window.confirm(
        `${replaced.map((f) => f.name).join('・')} は、今のファイルをごみ箱に移してから原本に置き換えます。よろしいですか？`
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      show(await window.api.updateRuleFiles(names))
      setMessage(`${names.length} 件を最新にしました。`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dialog-section">
      <h3>ルールのファイル</h3>
      <p className="dialog-note">
        tasks フォルダの RULES.md などを、このアプリの版の原本にします。AI
        がノートや議事メモの書き方に従うには、最新の RULES.md と CLAUDE.md・AGENTS.md が要ります。
      </p>
      {files === null && !error && <p className="dialog-note">確かめています…</p>}
      {files && (
        <ul className="rule-files">
          {files.map((f) => (
            <li key={f.name}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={f.state === 'same' || busy}
                  checked={chosen.has(f.name)}
                  onChange={(e) => {
                    const next = new Set(chosen)
                    if (e.target.checked) next.add(f.name)
                    else next.delete(f.name)
                    setChosen(next)
                  }}
                />
                <code>{f.name}</code>
                <span className={`rule-state ${f.state}`}>{RULE_STATE_LABELS[f.state]}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="dialog-note">{message}</p>}
      {error && <p className="dialog-error">{error}</p>}
      {files && (
        <div className="dialog-actions">
          <button type="button" disabled={busy || chosen.size === 0} onClick={() => void update()}>
            選んだファイルを最新にする
          </button>
        </div>
      )}
    </section>
  )
}

function SettingsDialog({ userName, folderReady, onSave, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(userName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await onSave(name)
      onClose()
    } catch (e) {
      setError(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">設定</h2>
        <p className="dialog-note">この PC だけの設定です。tasks フォルダには保存しません。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className="dialog-field">
            <span>自分の名前</span>
            <input
              ref={inputRef}
              value={name}
              maxLength={100}
              placeholder="未設定"
              onChange={(e) => setName(e.target.value)}
            />
            <small>
              新しく作るチケットの作成者（author）に入ります。担当者の絞り込みの「自分」にも使います。
            </small>
          </label>
          {error && <p className="dialog-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="primary" disabled={saving}>
              保存
            </button>
          </div>
        </form>
        {folderReady && <RuleFiles />}
      </div>
    </div>
  )
}

export default SettingsDialog
