// 標準の skill（templates/skills/）の評価を、見本のデータで動かす（npm run skill-evals）
//
// - tests/skill-evals/<skill>.json の場面ごとに、`claude -p` をモデルを変えて呼ぶ
// - 作業フォルダは、make-sandbox.mjs で作り直した見本（今の RULES.md・AI 向けの案内・skill も入る）のコピー
//   （利用者のデータには触れない）
// - 1回目（頼む文）は、道具を読むもの（Read・Glob・Grep）と Skill だけにする。書き込みは断るので、
//   人に確かめる前に書こうとしたかが分かる
// - 場面に followUp（人の答え。「1つ目だけ作って」など）があれば、同じ会話の2回目として送り、
//   そのときだけ Write・Edit を許す。場面ごとに見本をコピーし直し、書いた・変えたファイルを判定役に見せる
//   （書く段階の手順と、書いた後の見直しまでを評価するため）
// - 期待する skill（skills）が呼ばれたかは、使った道具から機械的に採点する
// - 出力が期待する動き（expected_behavior）に合っているかを、別の Claude（判定役）に判定してもらう
//
// 使い方：node scripts/run-skill-evals.mjs [--models haiku,sonnet,opus] [--skills 名前,…] [--judge sonnet]
//          [--concurrency 4] [--out <フォルダ>] [--only read|write]
// 公式のベストプラクティス（評価を作り、使うモデルすべてで試す）に沿うためのもので、CI では動かさない。
// 2回に分ける場面は、会話を続けるために Claude Code のセッションを残す（作業フォルダは一時フォルダ）

import { spawnSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const models = option('models', 'haiku,sonnet,opus').split(',')
const judgeModel = option('judge', 'sonnet')
// 同時に動かす数。多すぎると利用の上限に当たりやすい
const concurrency = Number(option('concurrency', '4'))
const outDir = resolve(option('out', join(tmpdir(), `mokkan-skill-evals-${Date.now()}`)))
/** read：1回目だけの場面、write：followUp のある場面、なし：両方 */
const only = option('only', '')
const evalDir = join(root, 'tests', 'skill-evals')
const skills = option(
  'skills',
  readdirSync(evalDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .join(',')
).split(',')
const claude =
  process.env.CLAUDE_BIN ||
  join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
// 1回の呼び出しを待つ上限（Opus で全部のチケットを読むと数分かかる）
const TIMEOUT_MS = 10 * 60 * 1000
/** 判定役に見せる、書いたファイルの数と1つあたりの文字数の上限 */
const MAX_CHANGED_FILES = 8
const MAX_FILE_CHARS = 3000

const READ_TOOLS = 'Read,Glob,Grep,Skill'
const WRITE_TOOLS = 'Read,Glob,Grep,Skill,Write,Edit'

/** 見本のデータを作り直す（make-sandbox.mjs。今の RULES.md・テンプレート・skill も置かれる） */
function prepareTasks() {
  const tasks = join(outDir, 'tasks')
  rmSync(tasks, { recursive: true, force: true })
  const made = spawnSync(process.execPath, [join(root, 'scripts', 'make-sandbox.mjs'), tasks], {
    encoding: 'utf8'
  })
  if (made.status !== 0) throw new Error(`見本を作れませんでした：${made.stderr}`)
  return tasks
}

/** フォルダの中のファイル（tasks/ からのパス → 中身）。.claude は除く */
function snapshot(dir) {
  const files = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.claude') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (statSync(p).isFile())
        files.set(relative(dir, p).split(sep).join('/'), readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return files
}

/** 前と後で、作った・変えた・消したファイル */
function changedFiles(before, after) {
  const changes = []
  for (const [path, text] of after) {
    if (!before.has(path)) changes.push({ path, kind: '作った', text })
    else if (before.get(path) !== text)
      changes.push({ path, kind: '変えた', text, before: before.get(path) })
  }
  for (const path of before.keys())
    if (!after.has(path)) changes.push({ path, kind: '消した', text: '' })
  return changes
}

/** claude を呼び、標準出力を返す。文は標準入力で渡す */
function runClaude(args, input, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(claude, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('時間内に終わりませんでした'))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`claude が終了コード ${code} で終わりました：${stderr.slice(0, 500)}`))
    })
    child.stdin.end(input, 'utf8')
  })
}

/** stream-json の出力から、使った道具と答えを読む */
function readStream(out) {
  const tools = []
  let result = null
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'assistant') {
      for (const item of event.message?.content ?? []) {
        if (item.type === 'tool_use') {
          tools.push(item.name === 'Skill' ? `Skill(${item.input?.skill ?? ''})` : item.name)
        }
      }
    } else if (event.type === 'result') {
      result = event
    }
  }
  return {
    text: result?.result ?? '',
    tools,
    denied: (result?.permission_denials ?? []).map((d) => d.tool_name)
  }
}

/**
 * 場面を1つ、モデルを1つで動かす
 * followUp があれば、同じ会話の2回目として送る（そのときだけ書き込みを許す）
 */
async function runScenario(tasks, model, scenario) {
  const common = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose']
  if (!scenario.followUp) {
    const out = await runClaude(
      [
        ...common,
        '--no-session-persistence',
        '--allowedTools',
        READ_TOOLS,
        '--disallowedTools',
        'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch'
      ],
      scenario.query,
      tasks
    )
    return { ...readStream(out), changes: [] }
  }
  const sessionId = randomUUID()
  const before = snapshot(tasks)
  const first = readStream(
    await runClaude(
      [
        ...common,
        '--session-id',
        sessionId,
        '--allowedTools',
        READ_TOOLS,
        '--disallowedTools',
        'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch'
      ],
      scenario.query,
      tasks
    )
  )
  const second = readStream(
    await runClaude(
      [
        ...common,
        '--resume',
        sessionId,
        '--allowedTools',
        WRITE_TOOLS,
        '--disallowedTools',
        'Bash,NotebookEdit,WebFetch,WebSearch'
      ],
      scenario.followUp,
      tasks
    )
  )
  return {
    text: `${first.text}\n\n[人の答え] ${scenario.followUp}\n\n${second.text}`,
    // 1回目で書こうとしていないか（人に確かめる前に書かない）を見るため、1回目の道具は分けて持つ
    firstTools: first.tools,
    tools: [...first.tools, ...second.tools],
    denied: [...first.denied, ...second.denied],
    changes: changedFiles(before, snapshot(tasks))
  }
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          pass: { type: 'boolean' },
          reason: { type: 'string' }
        },
        required: ['criterion', 'pass', 'reason']
      }
    }
  },
  required: ['results']
}

/** 判定役に見せる、書いたファイル */
function changesForJudge(changes) {
  if (changes.length === 0) return '（なし）'
  const cut = (s) => (s.length > MAX_FILE_CHARS ? `${s.slice(0, MAX_FILE_CHARS)}\n…（省略）` : s)
  return changes
    .slice(0, MAX_CHANGED_FILES)
    .map((c) =>
      [
        `### ${c.kind}：${c.path}`,
        ...(c.before !== undefined
          ? ['変える前：', '```', cut(c.before), '```', '変えた後：']
          : []),
        '```',
        cut(c.text),
        '```'
      ].join('\n')
    )
    .join('\n\n')
}

/**
 * 判定役に、期待する動きの項目ごとに合否を付けてもらう
 * files は終わった後の tasks/ の中身。一覧（リンク先があるか）と、場面の context のファイルの中身を見せる
 */
async function judge(scenario, run, today, files) {
  const context = (scenario.context ?? []).map((path) =>
    files.has(path)
      ? `### ${path}\n\`\`\`\n${files.get(path)}\n\`\`\``
      : `### ${path}\n（ありません）`
  )
  const prompt = [
    'あなたは、AI のアシスタントの動きを評価する判定役です。下の「頼んだこと」に対する「アシスタントの答え」「使った道具」「書いたファイル」が、「期待する動き」の各項目に合っているかを判定してください。',
    '- 項目ごとに pass（合っていれば true）と、短い理由を日本語で返します。',
    '- 「書き換えようとしていない」は、1回目の道具と断られた道具に Write・Edit・Bash がなく、答えが人に確かめる形になっていれば合っています。',
    '- 「書いたファイル」は、前と後の中身を比べたものです。ここにないファイルは変わっていません（同じファイルを何度か Edit しても1件です）。',
    '- リンクの相対パスは、リンクを書いたファイルのフォルダから辿り、「tasks/ のファイル」にあるかで判断します。',
    '- 項目が「〜したときは」のように条件付きで、その条件に当たることをしていなければ、合っています（理由にそう書きます）。',
    '- 判断できない項目は false にし、理由に判断できないと書きます。',
    `- 今日は ${today} です。`,
    '',
    `## 頼んだこと\n${scenario.query}`,
    ...(scenario.followUp ? ['', `## 人の答え（2回目）\n${scenario.followUp}`] : []),
    '',
    `## 期待する動き\n${scenario.expected_behavior.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
    '',
    ...(run.firstTools ? [`## 1回目に使った道具\n${run.firstTools.join(', ') || '（なし）'}`] : []),
    `## 使った道具（すべて）\n${run.tools.join(', ') || '（なし）'}`,
    `## 断られた道具\n${run.denied.join(', ') || '（なし）'}`,
    '',
    `## アシスタントの答え\n${run.text}`,
    '',
    `## 書いたファイル\n${changesForJudge(run.changes)}`,
    '',
    `## tasks/ のファイル（終わった後）\n${[...files.keys()].sort().join('\n')}`,
    ...(context.length ? ['', `## 参考のファイル\n${context.join('\n\n')}`] : [])
  ].join('\n')
  const out = await runClaude(
    [
      '-p',
      '--model',
      judgeModel,
      '--output-format',
      'json',
      '--tools',
      '',
      '--no-session-persistence',
      '--json-schema',
      JSON.stringify(VERDICT_SCHEMA)
    ],
    prompt,
    outDir
  )
  const parsed = JSON.parse(out)
  return (
    parsed.structured_output?.results ?? JSON.parse(/\{[\s\S]*\}/.exec(parsed.result)[0]).results
  )
}

/** 期待する skill が呼ばれたか（description が働いているか）を、使った道具から採点する */
function skillVerdicts(scenario, run) {
  return (scenario.skills ?? []).map((skill) => ({
    criterion: `skill ${skill} が呼ばれた`,
    pass: run.tools.includes(`Skill(${skill})`),
    reason: `使った skill：${run.tools.filter((t) => t.startsWith('Skill(')).join(' ') || 'なし'}`
  }))
}

function localDate() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const base = prepareTasks()
  const today = localDate()
  const jobs = []
  for (const skill of skills) {
    const scenarios = JSON.parse(readFileSync(join(evalDir, `${skill}.json`), 'utf8'))
    scenarios.forEach((scenario, index) => {
      if (only === 'read' && scenario.followUp) return
      if (only === 'write' && !scenario.followUp) return
      for (const model of models) jobs.push({ skill, index, scenario, model })
    })
  }
  console.log(`${jobs.length} 件を動かします（同時に ${concurrency} 件）。結果：${outDir}`)

  const results = []
  let next = 0
  async function worker() {
    while (next < jobs.length) {
      const id = next++
      const job = jobs[id]
      const label = `${job.skill} #${job.index + 1} ${job.model}${job.scenario.followUp ? '（書く）' : ''}`
      try {
        // 書く場面は、ほかの場面と混ざらないよう、見本をコピーし直して使う
        let tasks = base
        if (job.scenario.followUp) {
          tasks = join(outDir, 'work', String(id))
          cpSync(base, tasks, { recursive: true })
        }
        const run = await runScenario(tasks, job.model, job.scenario)
        const verdicts = [
          ...skillVerdicts(job.scenario, run),
          ...(await judge(job.scenario, run, today, snapshot(tasks)))
        ]
        const passed = verdicts.filter((v) => v.pass).length
        results.push({ ...job, run, verdicts })
        console.log(
          `${label}：${passed}/${verdicts.length}` +
            (run.changes.length ? ` / 書いたファイル ${run.changes.length}` : '') +
            (run.denied.length ? ` / 断られた道具=${run.denied.join(',')}` : '')
        )
      } catch (error) {
        results.push({ ...job, error: error.message })
        console.log(`${label}：失敗（${error.message}）`)
      }
      writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  // 判定で落ちた項目だけを並べる
  const failed = results.flatMap((r) =>
    (r.verdicts ?? [])
      .filter((v) => !v.pass)
      .map((v) => `- ${r.skill} #${r.index + 1} ${r.model}：${v.criterion}\n  理由：${v.reason}`)
  )
  console.log(
    failed.length ? `\n合わなかった項目：\n${failed.join('\n')}` : '\nすべての項目が合いました'
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
