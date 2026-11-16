// ノートの画面から、AI に「ノートからタスクを起こす」の候補を出してもらう
// パソコンに入っている AI ツール（Claude Code の `claude -p` か、Cursor CLI の `agent -p`。設定で選ぶ）を呼ぶ。
// キーの管理は要らないが、入っていないと使えない
// AI には候補を出してもらうだけで、チケットは作らせない（人が選んでから、アプリが作る。RULES.md の手順の 2）
// electron に依存しないので、Node 上でテストできる

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_SERVICE_NAMES, type AiService } from '../shared/aiService'
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

/**
 * RULES.md から「ノートからタスクを起こす」の節を取り出す。なければ null
 * 前の版の RULES.md の見出し「議事メモからタスクを起こす」も読む（tasks/ のファイルを更新していない人のため）
 */
export function extractRulesSection(rules: string): string | null {
  const lines = rules.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^##\s+(?:ノート|議事メモ)からタスクを起こす\s*$/.test(l))
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
  includeTranscript: boolean,
  /** 答えの形（JSON Schema）を文に書くか。形をコマンドの引数で指定できない AI（Cursor）のとき */
  schemaInPrompt = false
): { prompt: string; truncated: boolean; sentChars: number } {
  let body = includeTranscript ? note.body : removeTranscript(note.body)
  const truncated = body.length > MAX_NOTE_CHARS
  if (truncated) body = body.slice(0, MAX_NOTE_CHARS)
  const base = note.date ?? note.created
  const prompt = [
    'あなたは mokkan（md ファイルでタスクを管理するアプリ）から呼ばれています。下のノート（議事メモ・メモなど）から、タスクの候補を出してください。',
    '',
    '- 下の「手順」の 1（候補を出す）だけを行います。チケットは作らず、ファイルも読み書きしません。',
    '- 答えは決められた JSON の形で返します。',
    '- 「すでに作ったチケット」と同じタスクは、候補に入れません。',
    `- 期限は${note.date ? `ノートの日付（${note.date}）` : note.created ? `ノートの作成日（${note.created}。日付が空なので、こちらを基準にする）` : '本文から'}を基準に YYYY-MM-DD にします。はっきりしなければ null にします。`,
    '- 担当者がはっきりしなければ、空の配列にします。推測で埋めません。',
    '- 「宿題」の項目から起こした候補は、その項目の文（行頭の「- 」と、太字などの書式を除いた文字。「（高橋）」や「→ …」も含めて、項目に書いてあるとおり）を homework に入れます。それ以外は null にします。',
    '- evidence には、根拠になった箇所（発言や本文の文）を短く引用します。',
    '- 迷うものは、doubt に理由を書いて候補に入れます。',
    ...(truncated ? ['- ノートが長いので、途中までを送っています。'] : []),
    ...(!includeTranscript
      ? ['- 「文字起こし」は送っていません。要点・決定事項・宿題から候補を出します。']
      : []),
    '',
    ...(schemaInPrompt
      ? [
          '## 答えの形',
          '',
          '答えは、次の JSON Schema に合う JSON だけにしてください。説明の文やコードブロックの囲みは付けません。',
          '',
          JSON.stringify(CANDIDATES_SCHEMA),
          ''
        ]
      : []),
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

/**
 * `claude -p --output-format json`・`agent -p --output-format json` の出力から候補を取り出す。形が違うものは捨てる
 * どちらも `is_error` と `result`（答えの文）を持つ。Claude Code は形を指定した答えを `structured_output` にも入れる
 */
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
 * ノートを AI に送り、タスクの候補を出してもらう（RULES.md「ノートからタスクを起こす」の 1）
 * @param noteBase 画面が最後に読んだノートの中身（これを送る）
 * @param bundledRules 同梱の RULES.md（tasks/RULES.md に手順の節がないとき使う）
 */
export async function suggestTasksFromNote(
  store: AiTaskStore,
  noteKey: string,
  noteBase: string,
  includeTranscript: boolean,
  bundledRules: string,
  service: AiService = 'claude',
  run: (prompt: string) => Promise<string> = (prompt) => runAi(service, prompt)
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
    includeTranscript,
    // Cursor CLI には答えの形を指定する引数がないので、文に書く
    service === 'cursor'
  )
  try {
    const candidates = parseCandidates(await run(prompt))
    // すでに作ったチケットと同じタイトルの候補は外す（AI にも頼んであるが、念のため）
    const known = new Set(existing)
    return { status: 'ok', candidates: candidates.filter((c) => !known.has(c.title)), truncated }
  } catch (error) {
    if (error instanceof AiNotFoundError) return { status: 'not-installed' }
    return { status: 'error', message: (error as Error).message }
  }
}

/** AI ツール（claude・agent）が見つからない */
export class AiNotFoundError extends Error {
  constructor(service: AiService) {
    super(`${AI_SERVICE_NAMES[service]} が見つかりません`)
  }
}

/** 選んだ AI ツールに文を送り、出力（JSON）を返す */
export function runAi(service: AiService, prompt: string): Promise<string> {
  return service === 'cursor' ? runCursor(prompt) : runClaude(prompt)
}

type Spawn = typeof nodeSpawn

/** 呼ぶコマンドと、その前に付ける引数（Cursor CLI は node.exe に index.js を渡して呼ぶ） */
export interface AiCommand {
  command: string
  prefixArgs: string[]
}

/** 呼ぶ claude の候補（PATH にあるもの → ネイティブ版の既定の場所） */
function claudeCommands(): AiCommand[] {
  const native = join(
    homedir(),
    '.local',
    'bin',
    process.platform === 'win32' ? 'claude.exe' : 'claude'
  )
  return ['claude', ...(existsSync(native) ? [native] : [])].map((command) => ({
    command,
    prefixArgs: []
  }))
}

/** 呼んでいる途中の AI ツール（止めるため） */
let running: ChildProcess | null = null

/** 呼んでいる途中の AI ツールを止める */
export function cancelAi(): void {
  running?.kill()
}

/**
 * `claude -p` に文を送り、出力（JSON）を返す
 * 道具（ファイルの読み書きやコマンド）は使わせず、セッションも残さない。
 * 作業フォルダは、呼ぶたびに作る空の一時フォルダにする。Windows はコマンドを PATH より先に作業フォルダから探すので、
 * 誰でも書ける %TEMP% そのものを作業フォルダにすると、そこに置かれた claude.exe が動いてしまう
 * @throws AiNotFoundError：claude が見つからない
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
  return runFirstFound('claude', claudeCommands(), args, prompt, cwd, spawn)
}

/** 候補のコマンドを順に試し、見つかった最初のもので呼ぶ */
async function runFirstFound(
  service: AiService,
  commands: AiCommand[],
  args: string[],
  prompt: string,
  cwd: string,
  spawn: Spawn
): Promise<string> {
  for (const { command, prefixArgs } of commands) {
    try {
      return await runOnce(service, spawn, command, [...prefixArgs, ...args], prompt, cwd)
    } catch (error) {
      if (!(error instanceof AiNotFoundError)) throw error
    }
  }
  throw new AiNotFoundError(service)
}

/** 標準エラーから出す1行の上限（Cursor CLI はまとめた JS の長い行を出すことがある） */
const MAX_ERROR_LINE = 300

/**
 * AI ツールが 0 以外の終了コードで終わったときに出す理由
 * - Windows のスマート アプリ コントロールなど（Application Control）が部品を止めたときは、そのことを案内する
 *   （Cursor CLI は署名のない部品を使うので、スマート アプリ コントロールが有効な PC では動かない）
 * - 出力の JSON に理由（result）があればそれを、なければ標準エラーの `Error:` で始まる行（なければ最初の行）を出す
 */
export function failureMessage(
  service: AiService,
  code: number | null,
  stdout: string,
  stderr: string
): string {
  const name = AI_SERVICE_NAMES[service]
  if (/Application Control policy has blocked/i.test(stderr)) {
    return `Windows のスマート アプリ コントロール（またはアプリの制御のポリシー）が ${name} の部品を止めたため、${name} を動かせませんでした。この PC では ${name} を使えないので、設定で別の AI を選んでください。`
  }
  try {
    const result = asText((JSON.parse(stdout) as Record<string, unknown>).result)
    if (result) return result
  } catch {
    // JSON でなければ、標準エラーを使う
  }
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const line = lines.find((l) => l.startsWith('Error:')) ?? lines[0]
  return line ? line.slice(0, MAX_ERROR_LINE) : `${name} が終了コード ${code} で終わりました`
}

function runOnce(
  service: AiService,
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
      reject(error.code === 'ENOENT' ? new AiNotFoundError(service) : error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      running = null
      if (signal) reject(new Error('止めました'))
      else if (code !== 0) reject(new Error(failureMessage(service, code, stdout, stderr)))
      else resolve(stdout)
    })
    child.stdin?.end(prompt, 'utf8')
  })
}

// ---- Cursor CLI ----

/**
 * Cursor CLI の版のフォルダの名前を、新しさを比べる数の並びにする。読めない名前なら null
 * `2026.06.19-653a7fb` と、時刻の付いた `2026.06.19-20-24-33-653a7fb` の両方を読む
 */
export function cursorVersionKey(name: string): number[] | null {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{1,2})-(\d{1,2})-(\d{1,2}))?-[0-9a-z]+$/i.exec(
    name
  )
  return m ? m.slice(1).map((v) => Number(v ?? 0)) : null
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 呼ぶ Cursor CLI の候補
 * - Windows：インストーラーが置く `%LOCALAPPDATA%\cursor-agent\versions\<版>\node.exe` に `index.js` を渡して呼ぶ。
 *   PATH に入るのは agent.cmd（中で PowerShell を呼ぶ）だけで、シェルを通さずには呼べないため。
 *   版のフォルダは、名前の日付・時刻がいちばん新しく、node.exe と index.js があるもの
 * - そのほか：PATH の agent・cursor-agent と、インストーラーが置く ~/.local/bin/agent
 */
export function cursorCommands(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fs: { existsSync: (path: string) => boolean; readdirSync: (path: string) => string[] } = {
    existsSync,
    readdirSync: (path) => readdirSync(path)
  }
): AiCommand[] {
  if (platform === 'win32') {
    const versions = join(
      env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'),
      'cursor-agent',
      'versions'
    )
    let names: string[]
    try {
      names = fs.readdirSync(versions)
    } catch {
      return []
    }
    const found = names
      .map((name) => ({ name, key: cursorVersionKey(name) }))
      .filter((v): v is { name: string; key: number[] } => v.key !== null)
      .sort((a, b) => compareKeys(b.key, a.key))
      .find(
        (v) =>
          fs.existsSync(join(versions, v.name, 'node.exe')) &&
          fs.existsSync(join(versions, v.name, 'index.js'))
      )
    return found
      ? [
          {
            command: join(versions, found.name, 'node.exe'),
            prefixArgs: [join(versions, found.name, 'index.js')]
          }
        ]
      : []
  }
  const local = join(homedir(), '.local', 'bin', 'agent')
  return ['agent', 'cursor-agent', ...(fs.existsSync(local) ? [local] : [])].map((command) => ({
    command,
    prefixArgs: []
  }))
}

/**
 * 作業フォルダに置く Cursor CLI の設定（`.cursor/cli.json`）。シェル・ファイルの読み書き・Web・MCP をすべて断る
 * 答えは文で返してもらうだけなので、道具は要らない（Claude Code の `--tools ""` に当たるものが CLI にないため）
 */
export const CURSOR_DENY_ALL = {
  permissions: {
    allow: [],
    deny: ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)']
  }
}

/**
 * Cursor CLI（`agent -p`）に文を送り、出力（JSON）を返す
 * - 質問に答えるだけのモード（`--mode ask`）で呼び、`--force` は付けない（ファイルを書き換えさせない）
 * - 作業フォルダは、呼ぶたびに作る空の一時フォルダにし、道具をすべて断る設定を置く
 * - Cursor CLI には会話を残さない設定がないので、会話は Cursor の履歴に残る
 * @throws AiNotFoundError：Cursor CLI が見つからない
 */
export async function runCursor(
  prompt: string,
  spawn: Spawn = nodeSpawn,
  commands: AiCommand[] = cursorCommands()
): Promise<string> {
  if (commands.length === 0) throw new AiNotFoundError('cursor')
  const cwd = await mkdtemp(join(tmpdir(), 'mokkan-cursor-'))
  try {
    await mkdir(join(cwd, '.cursor'))
    await writeFile(join(cwd, '.cursor', 'cli.json'), JSON.stringify(CURSOR_DENY_ALL, null, 2))
    const args = ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', cwd]
    return await runFirstFound('cursor', commands, args, prompt, cwd, spawn)
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}
