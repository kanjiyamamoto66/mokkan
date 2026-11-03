// ノートの画面から、AI に「議事メモからタスクを起こす」の候補を出してもらう
// パソコンに入っている Claude Code（`claude -p`）を呼ぶ。キーの管理は要らないが、入っていないと使えない
// AI には候補を出してもらうだけで、チケットは作らせない（人が選んでから、アプリが作る。RULES.md の手順の 2）
// electron に依存しないので、Node 上でテストできる

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiCandidate, AiSuggestResult } from '../shared/api'
import { isNoteKey, parseNote } from '../shared/note'
import { removeTranscript } from '../shared/search'
import { validDate } from '../shared/schedule'
import { splitFrontmatter } from '../shared/ticket'

/** AI に送るノートの本文の長さの上限（1時間の会議の文字起こしでも、たいていは収まる） */
export const MAX_NOTE_CHARS = 120_000
/** AI の答えを待つ時間の上限 */
const TIMEOUT_MS = 5 * 60 * 1000
/** 速さと料金で選ぶ。`sonnet` はその時点の最新の Sonnet を指す */
const MODEL = 'sonnet'

/** AI に返してもらう形（`claude -p --json-schema`） */
export const CANDIDATES_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'チケットのタイトル（やることを短く）' },
          assignees: {
            type: 'array',
            items: { type: 'string' },
            description: '担当者。はっきりしなければ空'
          },
          due: {
            type: ['string', 'null'],
            description: '期限（YYYY-MM-DD）。はっきりしなければ null'
          },
          evidence: { type: 'string', description: '根拠になった発言を短く引用したもの' },
          homework: {
            type: ['string', 'null'],
            description:
              '「宿題」の項目から起こしたときは、その項目の文（「- 」と書式を除いた文字）。それ以外は null'
          },
          doubt: {
            type: ['string', 'null'],
            description: '迷っているときの理由。迷っていなければ null'
          }
        },
        required: ['title', 'assignees', 'due', 'evidence', 'homework', 'doubt']
      }
    }
  },
  required: ['candidates']
} as const

/** RULES.md から「議事メモからタスクを起こす」の節を取り出す。なければ null */
export function extractRulesSection(rules: string): string | null {
  const lines = rules.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^##\s+議事メモからタスクを起こす\s*$/.test(l))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^##\s/.test(lines[end])) end++
  return lines.slice(start, end).join('\n').trim()
}

export interface NoteForAi {
  title: string
  date: string | null
  created: string | null
  /** frontmatter を除いた本文 */
  body: string
}

/**
 * AI に送る文を組み立てる
 * @param existingTitles このノートからすでに作ったチケットのタイトル（候補から外してもらう）
 * @returns 送る文と、長すぎて途中で切ったか
 */
export function buildPrompt(
  note: NoteForAi,
  rulesSection: string,
  existingTitles: string[],
  includeTranscript: boolean
): { prompt: string; truncated: boolean; sentChars: number } {
  let body = includeTranscript ? note.body : removeTranscript(note.body)
  const truncated = body.length > MAX_NOTE_CHARS
  if (truncated) body = body.slice(0, MAX_NOTE_CHARS)
  const base = note.date ?? note.created
  const prompt = [
    'あなたは mokkan（md ファイルでタスクを管理するアプリ）から呼ばれています。下の議事メモ（ノート）から、タスクの候補を出してください。',
    '',
    '- 下の「手順」の 1（候補を出す）だけを行います。チケットは作らず、ファイルも読み書きしません。',
    '- 答えは決められた JSON の形で返します。',
    '- 「すでに作ったチケット」と同じタスクは、候補に入れません。',
    `- 期限は${note.date ? `ノートの日付（${note.date}）` : note.created ? `ノートの作成日（${note.created}。日付が空なので、こちらを基準にする）` : '本文から'}を基準に YYYY-MM-DD にします。はっきりしなければ null にします。`,
    '- 担当者がはっきりしなければ、空の配列にします。推測で埋めません。',
    '- 「宿題」の項目から起こした候補は、その項目の文（行頭の「- 」と、太字などの書式を除いた文字。「（高橋）」や「→ …」も含めて、項目に書いてあるとおり）を homework に入れます。それ以外は null にします。',
    '- evidence には、根拠になった発言を短く引用します。',
    '- 迷うものは、doubt に理由を書いて候補に入れます。',
    ...(truncated ? ['- ノートが長いので、途中までを送っています。'] : []),
    ...(!includeTranscript
      ? ['- 「文字起こし」は送っていません。要点・決定事項・宿題から候補を出します。']
      : []),
    '',
    '## 手順（RULES.md より）',
    '',
    rulesSection,
    '',
    '## すでに作ったチケット',
    '',
    ...(existingTitles.length > 0 ? existingTitles.map((t) => `- ${t}`) : ['（なし）']),
    '',
    '## ノート',
    '',
    `タイトル：${note.title || '（タイトルなし）'}`,
    `date：${note.date ?? '（空）'}`,
    `created：${note.created ?? '（空）'}`,
    ...(base ? [] : ['（日付が空なので、期限は本文に日付が書いてあるときだけ入れてください）']),
    '',
    '本文：',
    '<<<',
    body,
    '>>>'
  ].join('\n')
  return { prompt, truncated, sentChars: body.length }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** `claude -p --output-format json` の出力から候補を取り出す。形が違うものは捨てる */
export function parseCandidates(stdout: string): AiCandidate[] {
  const result = JSON.parse(stdout) as Record<string, unknown>
  if (result.is_error === true) {
    throw new Error(asText(result.result) ?? 'AI がエラーを返しました')
  }
  let data = result.structured_output as Record<string, unknown> | undefined
  if (!data && typeof result.result === 'string') {
    // 形を指定した答えが入っていないときは、文の答えから JSON を探す
    const match = /\{[\s\S]*\}/.exec(result.result)
    if (match) data = JSON.parse(match[0]) as Record<string, unknown>
  }
  const list = data?.candidates
  if (!Array.isArray(list)) throw new Error('AI の答えの形が違います')
  return list.flatMap((c): AiCandidate[] => {
    if (!c || typeof c !== 'object') return []
    const item = c as Record<string, unknown>
    const title = asText(item.title)
    if (!title) return []
    return [
      {
        // タイトルは見出しの1行とノートの「宿題」の1行に書くので、改行などは空白にする
        // eslint-disable-next-line no-control-regex
        title: title.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200),
        assignees: Array.isArray(item.assignees)
          ? item.assignees.flatMap((a) => (asText(a) ? [asText(a)!] : []))
          : [],
        due: validDate(asText(item.due)),
        evidence: asText(item.evidence) ?? '',
        homework: asText(item.homework),
        doubt: asText(item.doubt)
      }
    ]
  })
}

/** 候補を出してもらうのに使う、TaskStore の機能 */
export interface AiTaskStore {
  readTicket: (key: string) => Promise<string | null>
  getState: () => { tickets: { source: string | null; title: string }[] }
  /** tasks/RULES.md（なければ同梱の原本） */
  readRules: () => Promise<string>
}

/**
 * ノートを AI に送り、タスクの候補を出してもらう（RULES.md「議事メモからタスクを起こす」の 1）
 * @param noteBase 画面が最後に読んだノートの中身（これを送る）
 * @param bundledRules 同梱の RULES.md（tasks/RULES.md に手順の節がないとき使う）
 */
export async function suggestTasksFromNote(
  store: AiTaskStore,
  noteKey: string,
  noteBase: string,
  includeTranscript: boolean,
  bundledRules: string,
  run: (prompt: string) => Promise<string> = (prompt) => runClaude(prompt)
): Promise<AiSuggestResult> {
  if (!isNoteKey(noteKey) || (await store.readTicket(noteKey)) === null) {
    throw new Error('ノートが見つかりません')
  }
  const note = parseNote(noteKey, noteBase)
  const rulesSection =
    extractRulesSection(await store.readRules()) ?? extractRulesSection(bundledRules) ?? ''
  const existing = note.id
    ? store
        .getState()
        .tickets.filter((t) => t.source === note.id)
        .map((t) => t.title || '（タイトルなし）')
    : []
  const { prompt, truncated } = buildPrompt(
    {
      title: note.title,
      date: note.date,
      created: note.created,
      body: splitFrontmatter(noteBase)?.body ?? noteBase
    },
    rulesSection,
    existing,
    includeTranscript
  )
  try {
    const candidates = parseCandidates(await run(prompt))
    // すでに作ったチケットと同じタイトルの候補は外す（AI にも頼んであるが、念のため）
    const known = new Set(existing)
    return { status: 'ok', candidates: candidates.filter((c) => !known.has(c.title)), truncated }
  } catch (error) {
    if (error instanceof ClaudeNotFoundError) return { status: 'not-installed' }
    return { status: 'error', message: (error as Error).message }
  }
}

/** Claude Code が見つからない */
export class ClaudeNotFoundError extends Error {
  constructor() {
    super('Claude Code（claude コマンド）が見つかりません')
  }
}

type Spawn = typeof nodeSpawn

/** 呼ぶ claude の候補（PATH にあるもの → ネイティブ版の既定の場所） */
function claudeCommands(): string[] {
  const native = join(
    homedir(),
    '.local',
    'bin',
    process.platform === 'win32' ? 'claude.exe' : 'claude'
  )
  return ['claude', ...(existsSync(native) ? [native] : [])]
}

/** 呼んでいる途中の claude（止めるため） */
let running: ChildProcess | null = null

/** 呼んでいる途中の claude を止める */
export function cancelClaude(): void {
  running?.kill()
}

/**
 * `claude -p` に文を送り、出力（JSON）を返す
 * 道具（ファイルの読み書きやコマンド）は使わせず、セッションも残さない。
 * 作業フォルダは、呼ぶたびに作る空の一時フォルダにする。Windows はコマンドを PATH より先に作業フォルダから探すので、
 * 誰でも書ける %TEMP% そのものを作業フォルダにすると、そこに置かれた claude.exe が動いてしまう
 * @throws ClaudeNotFoundError：claude が見つからない
 */
export async function runClaude(prompt: string, spawn: Spawn = nodeSpawn): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'mokkan-claude-'))
  try {
    return await runClaudeIn(cwd, prompt, spawn)
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function runClaudeIn(cwd: string, prompt: string, spawn: Spawn): Promise<string> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    MODEL,
    '--tools',
    '',
    '--no-session-persistence',
    '--json-schema',
    JSON.stringify(CANDIDATES_SCHEMA)
  ]
  for (const command of claudeCommands()) {
    try {
      return await runOnce(spawn, command, args, prompt, cwd)
    } catch (error) {
      if (!(error instanceof ClaudeNotFoundError)) throw error
    }
  }
  throw new ClaudeNotFoundError()
}

function runOnce(
  spawn: Spawn,
  command: string,
  args: string[],
  prompt: string,
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 文はコマンドの引数ではなく標準入力で渡す（シェルを通さないので、本文の文字がコマンドとして読まれることはない）
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    running = child
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('AI の答えが時間内に返ってきませんでした'))
    }, TIMEOUT_MS)
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      running = null
      reject(error.code === 'ENOENT' ? new ClaudeNotFoundError() : error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      running = null
      if (signal) reject(new Error('止めました'))
      else if (code !== 0) {
        // ログインしていないなどのときは、出力の JSON に理由が入っていることがある
        let message = stderr.trim().split('\n')[0] || `claude が終了コード ${code} で終わりました`
        try {
          message = asText((JSON.parse(stdout) as Record<string, unknown>).result) ?? message
        } catch {
          // JSON でなければ、標準エラーの1行目を使う
        }
        reject(new Error(message))
      } else resolve(stdout)
    })
    child.stdin?.end(prompt, 'utf8')
  })
}
