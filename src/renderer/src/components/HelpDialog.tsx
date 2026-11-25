// ヘルプ（上の帯の「？」から開く）。画面ごとのタブに、どこを押すと何ができるかと、手元の AI に頼める文の例を出す
// 細かいことは使い方のページ（docs/guide.md）が正。AI に頼む文は「コピー」で裏方がクリップボードに入れる（文の id だけを渡す）

import { useEffect, useRef, useState } from 'react'
import { AI_SERVICE_NAMES, DEFAULT_AI_SERVICE, type AiService } from '../../../shared/aiService'
import {
  HELP_SECTIONS,
  HELP_TOPICS,
  HELP_TOPIC_LABELS,
  guideUrl,
  START_LAUNCH,
  START_PROMPTS,
  START_SKILLS,
  type HelpPrompt,
  type HelpTopic
} from '../../../shared/help'

interface Props {
  /** 最初に開くタブ（今の画面。初めての起動では「はじめに」で、見出しも「mokkan へようこそ」にする） */
  initial: HelpTopic
  /** 今の tasks/ のフォルダ（「はじめに」に出す） */
  tasksDir: string | null
  onClose: () => void
}

/** 「コピーしました」を出しておく時間。戻すので、同じボタンをもう一度押しても手応えがある */
const COPIED_MS = 2000

/** 押したボタンの印（key）を、しばらくだけ立てる */
function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const mark = (key: string): void => {
    setCopied(key)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), COPIED_MS)
  }
  return [copied, mark]
}

/** AI に頼む文と、コピーのボタン */
export function PromptList({ prompts }: { prompts: HelpPrompt[] }): React.JSX.Element {
  const [copied, markCopied] = useCopied()
  const [error, setError] = useState<string | null>(null)
  const copy = async (id: string): Promise<void> => {
    setError(null)
    try {
      await window.api.copyHelpPrompt(id)
      markCopied(id)
    } catch (e) {
      setError(`コピーできませんでした：${(e as Error).message}`)
    }
  }
  return (
    <>
      <ul className="help-prompts">
        {prompts.map((p) => (
          <li key={p.id}>
            <span className="help-prompt-text">
              {p.text}
              {p.skill && <small className="help-skill">/{p.skill} でも呼べます</small>}
            </span>
            <button type="button" className="ghost" onClick={() => void copy(p.id)}>
              {copied === p.id ? 'コピーしました' : 'コピー'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="dialog-error">{error}</p>}
    </>
  )
}

/** はじめに：AI に指定するフォルダと、最初に頼む文 */
function StartGuide({ tasksDir }: { tasksDir: string | null }): React.JSX.Element {
  const [service, setService] = useState<AiService>(DEFAULT_AI_SERVICE)
  const [copied, markCopied] = useCopied()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api
      .getAiService()
      .then(setService)
      .catch((e) => console.error('[mokkan] 使う AI の設定を読めませんでした', e))
  }, [])
  const copyDir = async (): Promise<void> => {
    setError(null)
    try {
      await window.api.copyTasksDir()
      markCopied('dir')
    } catch (e) {
      setError(`コピーできませんでした：${(e as Error).message}`)
    }
  }

  return (
    <>
      <p className="dialog-note">
        mokkan のチケットとノートは、ただの md ファイルです。手元の AI（{AI_SERVICE_NAMES[service]}
        など）にファイルを読み書きしてもらうと、ノートからタスクを起こしたり、ノートを整理したりできます。
      </p>
      <h3>1. AI に指定するフォルダ</h3>
      <p className="help-text">
        AI は、mokkan のデータのフォルダ（下の場所）で起動してください。このフォルダの
        CLAUDE.md・AGENTS.md が AI への案内になり、AI は RULES.md
        の決まりでファイルを読み書きします。ほかのフォルダで起動すると、決まりを読まずに動くことがあります。
      </p>
      <div className="help-folder">
        <code>{tasksDir ?? '（まだフォルダを選んでいません）'}</code>
        <button type="button" className="ghost" disabled={!tasksDir} onClick={() => void copyDir()}>
          {copied === 'dir' ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      {error && <p className="dialog-error">{error}</p>}
      <ul className="help-launch">
        {START_LAUNCH[service].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="dialog-note">
        使っている AI は「設定」で選べます（今は {AI_SERVICE_NAMES[service]}）。
      </p>
      <h3>2. 最初に頼む文（例）</h3>
      <PromptList prompts={START_PROMPTS} />
      <p className="dialog-note">（ ）の中は、自分の内容に置き換えます。</p>
      <h3>3. 用意してある作業の手順（skill）</h3>
      <p className="help-text">
        mokkan のデータのフォルダの .claude/skills/
        に、よくある作業の手順を置いています。ふつうの文で頼めば AI が合う手順を使い、/名前
        で呼ぶこともできます。どれも、案を出して確かめてから書き換えます。
      </p>
      <ul className="help-skills">
        {START_SKILLS.map((s) => (
          <li key={s.name}>
            <code>/{s.name}</code>
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      <p className="dialog-note">
        この案内は、右上の「？」の「はじめに」からいつでも開けます。画面ごとのタブには、その画面でできることと頼める文の例があります。
      </p>
    </>
  )
}

function HelpDialog({ initial, tasksDir, onClose }: Props): React.JSX.Element {
  const [topic, setTopic] = useState<HelpTopic>(initial)
  const section = topic === 'start' ? null : HELP_SECTIONS[topic]

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 初めての起動で自動で開くときは、頼まれて開いたヘルプではないので、何の窓かを見出しで伝える */}
        <h2 id="help-title">{initial === 'start' ? 'mokkan へようこそ' : 'ヘルプ'}</h2>
        <div className="help-tabs" role="tablist">
          {HELP_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === topic}
              className={t === topic ? 'chip on' : 'chip'}
              onClick={() => setTopic(t)}
            >
              {HELP_TOPIC_LABELS[t]}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="help-body">
          {section === null ? (
            <StartGuide tasksDir={tasksDir} />
          ) : (
            <>
              <h3>できること</h3>
              <dl className="help-actions">
                {section.actions.map((a) => (
                  <div key={a.label}>
                    <dt>{a.label}</dt>
                    <dd>{a.text}</dd>
                  </div>
                ))}
              </dl>
              <h3>手元の AI に頼めること（例）</h3>
              <p className="dialog-note">
                AI は tasks/ のフォルダで起動してください（「はじめに」のタブ）。（
                ）の中は、自分の内容に置き換えます。
              </p>
              <PromptList prompts={section.prompts} />
            </>
          )}
        </div>
        <div className="dialog-actions">
          <a href={guideUrl(topic)} target="_blank" rel="noreferrer" className="help-readme">
            この画面の詳しい使い方
          </a>
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

export default HelpDialog
