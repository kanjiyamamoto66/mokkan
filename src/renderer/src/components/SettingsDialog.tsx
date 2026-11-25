// 個人設定の画面（tasks/ の外の settings.json に保存する。共有するデータには書かない）

import { useEffect, useRef, useState } from 'react'
import {
  AI_SERVICES,
  AI_SERVICE_NAMES,
  asAiService,
  type AiService
} from '../../../shared/aiService'
import type { RuleFileStatus } from '../../../shared/api'
import { isRuleBundle, ruleFileLabel } from '../../../shared/ruleFiles'
import { formatTime, parseTime } from '../../../shared/day'

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
 * tasks/ のルールのファイル（RULES.md・テンプレート・CLAUDE.md・AGENTS.md・skill）を、このアプリの原本にする
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
        がノートの書き方やタスクの起こし方に従うには、最新の RULES.md・CLAUDE.md・AGENTS.md と
        skill（.claude/skills/ に置く作業の手順）が要ります。RULES.md と skill
        は一緒に更新します。テンプレートの見本は、ないときだけ置きます（手で直したものは置き換えません）。
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
                    // RULES.md と skill は一緒に更新するので、チェックもまとめて付け外しする
                    const group = isRuleBundle(f.name)
                      ? files.filter((g) => isRuleBundle(g.name) && g.state !== 'same')
                      : [f]
                    for (const g of group) {
                      if (e.target.checked) next.add(g.name)
                      else next.delete(g.name)
                    }
                    setChosen(next)
                  }}
                />
                <code title={f.name}>{ruleFileLabel(f.name)}</code>
                <span className={`rule-state ${f.state}`}>
                  {f.sample
                    ? f.state === 'missing'
                      ? 'テンプレートの見本（ない）'
                      : 'テンプレートの見本（ある）'
                    : RULE_STATE_LABELS[f.state]}
                </span>
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

/**
 * 作業する時間（時間割で薄く塗り、入り切るかの目安に使う）。「保存」で tasks/days/routine.md の
 * frontmatter の work に書く（AI が時間割を組むときにも読めるように、個人設定ではなくファイルに置く）
 */
function WorkHoursSetting(): React.JSX.Element {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .getWorkHours()
      .then((hours) => {
        setStart(formatTime(hours.start))
        setEnd(formatTime(hours.end))
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const save = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    const s = parseTime(start)
    const e = parseTime(end)
    if (s === null || e === null || e <= s) {
      setError('始まりと終わりを 9:00 のように入れ、終わりを始まりより後にしてください')
      return
    }
    try {
      await window.api.setWorkHours({ start: s, end: e })
      setMessage('保存しました。')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className="dialog-section">
      <h3>時間割</h3>
      <div className="dialog-field">
        <span>作業する時間</span>
        <span className="dialog-inline">
          <input
            aria-label="作業する時間の始まり"
            value={start}
            size={5}
            onChange={(e) => setStart(e.target.value)}
          />
          〜
          <input
            aria-label="作業する時間の終わり"
            value={end}
            size={5}
            onChange={(e) => setEnd(e.target.value)}
          />
          <button type="button" onClick={() => void save()}>
            保存
          </button>
        </span>
        <small>
          時間割でこの時間を薄く塗り、候補のチケットが入り切るかの目安に使います。tasks フォルダの
          days/routine.md に書くので、AI が時間割を組むときにも使います。
        </small>
      </div>
      {message && <p className="dialog-note">{message}</p>}
      {error && <p className="dialog-error">{error}</p>}
    </section>
  )
}

/** 使っている AI（「はじめに」とヘルプの起動のしかたの書き分けに使う）。選んだらすぐ保存する */
function AiServiceSetting(): React.JSX.Element {
  const [service, setService] = useState<AiService | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .getAiService()
      .then(setService)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const change = async (next: AiService): Promise<void> => {
    setError(null)
    try {
      await window.api.setAiService(next)
      setService(next)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section className="dialog-section">
      <h3>AI</h3>
      <label className="dialog-field">
        <span>使っている AI</span>
        <select
          value={service ?? ''}
          disabled={service === null}
          onChange={(e) => {
            const next = asAiService(e.target.value)
            if (next) void change(next)
          }}
        >
          {AI_SERVICES.map((s) => (
            <option key={s} value={s}>
              {AI_SERVICE_NAMES[s]}
            </option>
          ))}
        </select>
        <small>
          「？」の「はじめに」で、選んだ AI を mokkan
          のデータのフォルダで起動するやり方を案内します。アプリから AI
          を呼ぶことはありません。選ぶとすぐに保存します。
        </small>
      </label>
      {error && <p className="dialog-error">{error}</p>}
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
        <p className="dialog-note">
          この PC だけの設定です。tasks
          フォルダには保存しません（作業する時間とルールのファイルを除く）。
        </p>
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
        {folderReady && <WorkHoursSetting />}
        <AiServiceSetting />
        {folderReady && <RuleFiles />}
      </div>
    </div>
  )
}

export default SettingsDialog
