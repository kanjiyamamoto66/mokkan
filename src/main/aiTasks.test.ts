import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  AiNotFoundError,
  MAX_NOTE_CHARS,
  buildPrompt,
  cursorCommands,
  cursorVersionKey,
  extractRulesSection,
  failureMessage,
  parseCandidates,
  runClaude,
  runCursor,
  suggestTasksFromNote
} from './aiTasks'

const rules = readFileSync(join(__dirname, '../../templates/RULES.md'), 'utf8')

const noteText = (body: string): string =>
  `---\nid: 20261019-1400-m3k8\ndate: 2026-10-19\ntags: [A社]\nauthor:\ncreated: 2026-10-19\n---\n${body}`
const body =
  '\n# A社定例\n\n## 宿題\n- 見積書を送る（高橋）\n\n## 文字起こし\n高橋: 来週金曜までに見積書を送ります\n'

/** claude -p --output-format json の出力の形 */
const output = (candidates: unknown[]): string =>
  JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: { candidates } })

describe('extractRulesSection', () => {
  it('RULES.md から「ノートからタスクを起こす」の節だけを取り出す', () => {
    const section = extractRulesSection(rules)!
    expect(section.startsWith('## ノートからタスクを起こす')).toBe(true)
    expect(section).toContain('候補を出す')
    expect(section).not.toContain('## AIへのお願い')
    expect(section).not.toContain('## ノートの書き方')
    expect(extractRulesSection('# なし\n')).toBeNull()
  })

  it('前の版の見出し「議事メモからタスクを起こす」も読む', () => {
    const old =
      '# 書き方のルール\n\n## 議事メモからタスクを起こす\n\n1. 候補を出す\n\n## AIへのお願い\n- x\n'
    expect(extractRulesSection(old)).toBe('## 議事メモからタスクを起こす\n\n1. 候補を出す')
  })
})

describe('buildPrompt', () => {
  const note = { title: 'A社定例', date: '2026-10-19', created: '2026-10-19', body }

  it('手順・すでに作ったチケット・ノートの本文と日付を入れる', () => {
    const { prompt, truncated } = buildPrompt(note, '## 手順', ['請求書を送る'], true)
    expect(truncated).toBe(false)
    expect(prompt).toContain('## 手順')
    expect(prompt).toContain('- 請求書を送る')
    expect(prompt).toContain('ノートの日付（2026-10-19）')
    expect(prompt).toContain('高橋: 来週金曜までに見積書を送ります')
  })

  it('文字起こしを送らない選択では、その節を除く', () => {
    const { prompt } = buildPrompt(note, '', [], false)
    expect(prompt).not.toContain('来週金曜')
    expect(prompt).toContain('- 見積書を送る（高橋）')
  })

  it('長すぎる本文は途中で切り、そのことを伝える', () => {
    const long = { ...note, body: 'あ'.repeat(MAX_NOTE_CHARS + 10) }
    const { prompt, truncated, sentChars } = buildPrompt(long, '', [], true)
    expect(truncated).toBe(true)
    expect(sentChars).toBe(MAX_NOTE_CHARS)
    expect(prompt).toContain('途中までを送っています')
  })
})

describe('parseCandidates', () => {
  it('structured_output から候補を取り出し、正しくない期限や空のタイトルは捨てる', () => {
    expect(
      parseCandidates(
        output([
          {
            title: '見積書を送る',
            assignees: ['高橋', ''],
            due: '2026-10-23',
            evidence: '来週金曜までに',
            homework: '見積書を送る（高橋）',
            doubt: null
          },
          {
            title: '日程を決める\nあとで',
            assignees: [],
            due: '来週',
            evidence: '',
            homework: null,
            doubt: '誰がやるか不明'
          },
          { title: '', assignees: [], due: null, evidence: '', homework: null, doubt: null }
        ])
      )
    ).toEqual([
      {
        title: '見積書を送る',
        assignees: ['高橋'],
        due: '2026-10-23',
        evidence: '来週金曜までに',
        homework: '見積書を送る（高橋）',
        doubt: null
      },
      {
        title: '日程を決める あとで',
        assignees: [],
        due: null,
        evidence: '',
        homework: null,
        doubt: '誰がやるか不明'
      }
    ])
  })

  it('structured_output がなければ、文の答えから JSON を探す。エラーは理由を出す', () => {
    const text = JSON.stringify({ result: '候補です {"candidates":[{"title":"A"}]}' })
    expect(parseCandidates(text).map((c) => c.title)).toEqual(['A'])
    expect(() =>
      parseCandidates(JSON.stringify({ is_error: true, result: 'ログインしてください' }))
    ).toThrow('ログインしてください')
    expect(() => parseCandidates(JSON.stringify({ result: 'ありません' }))).toThrow('形が違います')
  })
})

/** 偽物の spawn が受け取ったもの（cwdEntries は呼ばれたときの作業フォルダの中身） */
interface Call {
  command: string
  args: string[]
  stdin: string
  cwd: string
  cwdEntries: string[]
}

/** spawn の偽物。stdin に書かれた文を受け取り、決めた出力を返す */
function fakeSpawn(behavior: { code?: number; stdout?: string; error?: string }): {
  spawn: typeof import('node:child_process').spawn
  calls: Call[]
} {
  const calls: Call[] = []
  const spawn = ((command: string, args: string[], options: { cwd: string }) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: () => void
    }
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => child.emit('close', null, 'SIGTERM')
    const call: Call = {
      command,
      args,
      stdin: '',
      cwd: options.cwd,
      cwdEntries: readdirSync(options.cwd)
    }
    calls.push(call)
    child.stdin.on('data', (d: Buffer) => (call.stdin += d.toString()))
    child.stdin.on('finish', () => {
      if (behavior.error) {
        child.emit('error', Object.assign(new Error(behavior.error), { code: behavior.error }))
        return
      }
      child.stdout.end(behavior.stdout ?? '')
      setImmediate(() => child.emit('close', behavior.code ?? 0, null))
    })
    return child
  }) as unknown as typeof import('node:child_process').spawn
  return { spawn, calls }
}

describe('runClaude', () => {
  it('文を標準入力で渡し、道具を使わせない設定で呼ぶ', async () => {
    const { spawn, calls } = fakeSpawn({ stdout: output([]) })
    expect(await runClaude('ノートの本文', spawn)).toBe(output([]))
    expect(calls[0].stdin).toBe('ノートの本文')
    expect(calls[0].args).toEqual(
      expect.arrayContaining(['-p', '--tools', '', '--no-session-persistence'])
    )
    // 本文は引数に入れない
    expect(calls[0].args.join(' ')).not.toContain('ノートの本文')
  })

  it('作業フォルダは、呼ぶたびに作る空のフォルダにし、終わったら消す', async () => {
    const { spawn, calls } = fakeSpawn({ stdout: output([]) })
    await runClaude('x', spawn)
    await runClaude('y', spawn)
    const [first, second] = calls
    // 誰でも書ける %TEMP% そのものではなく、その下に作ったフォルダ
    expect(first.cwd).not.toBe(tmpdir())
    expect(dirname(first.cwd)).toBe(tmpdir())
    expect(first.cwdEntries).toEqual([])
    expect(second.cwd).not.toBe(first.cwd)
    expect(existsSync(first.cwd)).toBe(false)
    expect(existsSync(second.cwd)).toBe(false)
  })

  it('claude が見つからなくても、作った作業フォルダは消す', async () => {
    const { spawn, calls } = fakeSpawn({ error: 'ENOENT' })
    await expect(runClaude('x', spawn)).rejects.toBeInstanceOf(AiNotFoundError)
    expect(calls.length).toBeGreaterThan(0)
    expect(existsSync(calls[0].cwd)).toBe(false)
  })

  it('claude が見つからなければ AiNotFoundError', async () => {
    const { spawn } = fakeSpawn({ error: 'ENOENT' })
    await expect(runClaude('x', spawn)).rejects.toBeInstanceOf(AiNotFoundError)
  })

  it('終了コードが 0 でなければ、理由を出す', async () => {
    const { spawn } = fakeSpawn({
      code: 1,
      stdout: JSON.stringify({ result: 'ログインしてください' })
    })
    await expect(runClaude('x', spawn)).rejects.toThrow('ログインしてください')
  })
})

describe('suggestTasksFromNote', () => {
  const store = {
    readTicket: async (key: string) => (key === 'notes/n.md' ? noteText(body) : null),
    getState: () => ({ tickets: [{ source: '20261019-1400-m3k8', title: '請求書を送る' }] }),
    readRules: async () => '# 手で直した RULES.md（手順の節がない）\n'
  }

  it('ノートを送り、すでに作ったチケットと同じタイトルの候補は外す', async () => {
    let sent = ''
    const result = await suggestTasksFromNote(
      store,
      'notes/n.md',
      noteText(body),
      true,
      rules,
      'claude',
      async (p) => {
        sent = p
        return output([
          {
            title: '見積書を送る',
            assignees: ['高橋'],
            due: null,
            evidence: '',
            homework: null,
            doubt: null
          },
          {
            title: '請求書を送る',
            assignees: [],
            due: null,
            evidence: '',
            homework: null,
            doubt: null
          }
        ])
      }
    )
    expect(result).toMatchObject({ status: 'ok', truncated: false })
    if (result.status === 'ok')
      expect(result.candidates.map((c) => c.title)).toEqual(['見積書を送る'])
    // tasks/RULES.md に手順がなければ、同梱の原本の手順を送る
    expect(sent).toContain('## ノートからタスクを起こす')
    expect(sent).toContain('- 請求書を送る')
  })

  it('claude がなければ not-installed、ほかの失敗は error で返す', async () => {
    expect(
      await suggestTasksFromNote(
        store,
        'notes/n.md',
        noteText(body),
        true,
        rules,
        'claude',
        async () => {
          throw new AiNotFoundError('claude')
        }
      )
    ).toEqual({ status: 'not-installed' })
    expect(
      await suggestTasksFromNote(
        store,
        'notes/n.md',
        noteText(body),
        true,
        rules,
        'claude',
        async () => 'JSON ではない'
      )
    ).toMatchObject({ status: 'error' })
  })

  it('Cursor のときは答えの形を文に書き、文の答え（result）から JSON を読む', async () => {
    let sent = ''
    const result = await suggestTasksFromNote(
      store,
      'notes/n.md',
      noteText(body),
      true,
      rules,
      'cursor',
      async (p) => {
        sent = p
        const answer = {
          candidates: [
            {
              title: '見積書を送る',
              assignees: ['高橋'],
              due: '2026-10-24',
              evidence: '来週金曜までに',
              homework: '見積書を送る（高橋）',
              doubt: null
            }
          ]
        }
        // 説明やコードブロックで囲んで返されても読む
        return JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: `候補です。\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
          session_id: 'x'
        })
      }
    )
    expect(sent).toContain('## 答えの形')
    expect(sent).toContain('"candidates"')
    expect(result).toMatchObject({
      status: 'ok',
      candidates: [{ title: '見積書を送る', due: '2026-10-24', homework: '見積書を送る（高橋）' }]
    })
  })

  it('Claude Code のときは答えの形を文に書かない（引数で渡す）', async () => {
    let sent = ''
    await suggestTasksFromNote(
      store,
      'notes/n.md',
      noteText(body),
      true,
      rules,
      'claude',
      async (p) => {
        sent = p
        return output([])
      }
    )
    expect(sent).not.toContain('## 答えの形')
  })

  it('ノートでないキーは受け付けない', async () => {
    await expect(
      suggestTasksFromNote(store, 'a.md', '', true, rules, 'claude', async () => '')
    ).rejects.toThrow()
  })
})

describe('Cursor CLI', () => {
  it('版のフォルダの名前を読む（時刻の付いた新しい形も）', () => {
    expect(cursorVersionKey('2026.06.19-653a7fb')).toEqual([2026, 6, 19, 0, 0, 0])
    expect(cursorVersionKey('2026.06.19-20-24-33-653a7fb')).toEqual([2026, 6, 19, 20, 24, 33])
    expect(cursorVersionKey('latest')).toBeNull()
  })

  it('Windows は、いちばん新しい版の node.exe に index.js を渡して呼ぶ（中身のない版は飛ばす）', () => {
    const base = join('C:\\Users\\u\\AppData\\Local', 'cursor-agent', 'versions')
    const has = new Set([
      join(base, '2026.06.19-653a7fb', 'node.exe'),
      join(base, '2026.06.19-653a7fb', 'index.js'),
      join(base, '2026.06.19-20-24-33-aaaaaaa', 'node.exe'),
      join(base, '2026.06.19-20-24-33-aaaaaaa', 'index.js'),
      // いちばん新しいが、index.js がない
      join(base, '2026.07.01-bbbbbbb', 'node.exe')
    ])
    const fs = {
      existsSync: (p: string) => has.has(p),
      readdirSync: () => [
        '2026.06.19-653a7fb',
        '2026.07.01-bbbbbbb',
        '2026.06.19-20-24-33-aaaaaaa',
        'tmp'
      ]
    }
    expect(cursorCommands('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, fs)).toEqual([
      {
        command: join(base, '2026.06.19-20-24-33-aaaaaaa', 'node.exe'),
        prefixArgs: [join(base, '2026.06.19-20-24-33-aaaaaaa', 'index.js')]
      }
    ])
    // フォルダがなければ候補なし（シェルを通さないと呼べない agent.cmd は使わない）
    const none = {
      existsSync: () => false,
      readdirSync: () => {
        throw new Error('ENOENT')
      }
    }
    expect(cursorCommands('win32', {}, none)).toEqual([])
  })

  it('文を標準入力で渡し、ask モード・道具をすべて断る設定の空のフォルダで呼ぶ', async () => {
    const { spawn, calls } = fakeSpawn({ stdout: '{"is_error":false,"result":"{}"}' })
    const commands = [{ command: 'node.exe', prefixArgs: ['index.js'] }]
    await runCursor('ノートの本文', spawn, commands)
    const call = calls[0]
    expect(call.command).toBe('node.exe')
    expect(call.args.slice(0, 2)).toEqual(['index.js', '-p'])
    expect(call.args).toEqual(
      expect.arrayContaining(['--output-format', 'json', '--mode', 'ask', '--workspace', call.cwd])
    )
    expect(call.args).not.toContain('--force')
    expect(call.args.join(' ')).not.toContain('ノートの本文')
    expect(call.stdin).toBe('ノートの本文')
    expect(dirname(call.cwd)).toBe(tmpdir())
    expect(call.cwdEntries).toEqual(['.cursor'])
    expect(existsSync(call.cwd)).toBe(false)
  })

  it('見つからなければ AiNotFoundError', async () => {
    const { spawn } = fakeSpawn({ error: 'ENOENT' })
    await expect(runCursor('x', spawn, [])).rejects.toBeInstanceOf(AiNotFoundError)
    await expect(
      runCursor('x', spawn, [{ command: 'agent', prefixArgs: [] }])
    ).rejects.toBeInstanceOf(AiNotFoundError)
  })

  it('終了コードが 0 でなければ、標準エラーの1行目を出す', async () => {
    const { spawn } = fakeSpawn({ code: 1, stdout: '' })
    await expect(runCursor('x', spawn, [{ command: 'agent', prefixArgs: [] }])).rejects.toThrow(
      'Cursor が終了コード 1 で終わりました'
    )
  })
})

describe('failureMessage', () => {
  it('スマート アプリ コントロールが止めたときは、そのことを案内する', () => {
    // Cursor CLI を Smart App Control が有効な PC で呼んだときの、実際の標準エラーの形
    const stderr = [
      'C:\\Users\\u\\AppData\\Local\\cursor-agent\\versions\\2026.11.11-b912975\\index.js:2',
      'x'.repeat(5000),
      '',
      'Error: Failed to load native binding for win32/x64 (expected: ./merkle-tree-napi.win32-x64-msvc.node)',
      'Original error: Error: node-loader:',
      'Error: An Application Control policy has blocked this file.'
    ].join('\n')
    expect(failureMessage('cursor', 1, '', stderr)).toContain('スマート アプリ コントロール')
    expect(failureMessage('cursor', 1, '', stderr)).toContain('設定で別の AI を選んで')
  })

  it('出力の JSON の理由 → 標準エラーの Error: の行 → 最初の行 → 終了コードの順に使う', () => {
    expect(failureMessage('claude', 1, '{"result":"ログインしてください"}', 'x')).toBe(
      'ログインしてください'
    )
    expect(failureMessage('cursor', 1, '', 'at a\nError: Authentication required\n')).toBe(
      'Error: Authentication required'
    )
    expect(failureMessage('cursor', 1, '', 'y'.repeat(400))).toHaveLength(300)
    expect(failureMessage('cursor', 2, '', '')).toBe('Cursor が終了コード 2 で終わりました')
  })
})
