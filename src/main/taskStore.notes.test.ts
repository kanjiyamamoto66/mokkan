// ノートのテンプレート・種類・フォルダ（notes/ の下の階層）と、チケットのテンプレートのテスト

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppState } from '../shared/api'
import { MAX_NOTE_FOLDER_DEPTH, SAMPLE_TEMPLATES, TaskStore } from './taskStore'

/** 条件を満たすまで待つ（ファイル監視は非同期なので） */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('時間内に条件を満たしませんでした')
    await new Promise((r) => setTimeout(r, 50))
  }
}

function noteText(id: string, title: string, extra = ''): string {
  return `---\nid: ${id}\n${extra}date: 2026-11-01\ntags: [定例]\nauthor:\ncreated: 2026-11-01\n---\n\n# ${title}\n`
}

describe('TaskStore：テンプレートとノートのフォルダ', () => {
  let tasksDir: string
  let notesDir: string
  let store: TaskStore | null
  let latest: AppState | null

  beforeEach(() => {
    tasksDir = mkdtempSync(join(tmpdir(), 'mokkan-test-'))
    notesDir = join(tasksDir, 'notes')
    mkdirSync(join(tasksDir, 'tickets'))
    store = null
    latest = null
  })

  afterEach(async () => {
    await store?.stop()
    rmSync(tasksDir, { recursive: true, force: true })
  })

  async function startStore(): Promise<TaskStore> {
    store = new TaskStore(tasksDir, (state) => (latest = state))
    await store.start()
    latest = store.getState()
    return store
  }

  const read = (key: string): string =>
    readFileSync(join(tasksDir, ...(key.startsWith('notes/') ? [key] : ['tickets', key])), 'utf8')

  describe('テンプレート', () => {
    it('tasks/templates/ の md の名前を、種類ごとに読む（フォルダがなければ空）', async () => {
      const s = await startStore()
      expect(await s.listTemplates()).toEqual({ tickets: [], notes: [] })
      await s.initFolder()
      mkdirSync(join(tasksDir, 'templates', 'tickets'))
      writeFileSync(join(tasksDir, 'templates', 'tickets', '不具合.md'), '---\nid:\n---\n')
      writeFileSync(join(tasksDir, 'templates', 'tickets', 'メモ.txt'), 'x')
      writeFileSync(join(tasksDir, 'templates', 'tickets', '.隠し.md'), 'x')
      const list = await s.listTemplates()
      expect(list.tickets).toEqual(['不具合'])
      expect(list.notes).toEqual(
        SAMPLE_TEMPLATES.map((t) => t.name.replace(/^templates\/notes\/|\.md$/g, '')).sort((a, b) =>
          a.localeCompare(b, 'ja')
        )
      )
    })

    it('選んだテンプレートでチケットを作る。テンプレートに値がある項目はそのまま、空の項目に初めの値を入れる', async () => {
      mkdirSync(join(tasksDir, 'templates', 'tickets'), { recursive: true })
      writeFileSync(
        join(tasksDir, 'templates', 'tickets', '不具合.md'),
        '---\nstatus: todo\npriority: 1\ntags: [不具合]\nassignee: 高橋\n---\n\n#\n\n## 再現手順\n'
      )
      const s = await startStore()
      const fileName = await s.createTicket('山田', ['仕事'], '不具合')
      const text = read(fileName)
      const id = fileName.replace(/\.md$/, '')
      // id と created の行がないテンプレートでも足す
      expect(text).toMatch(new RegExp(`^id: ${id}$`, 'm'))
      expect(text).toMatch(/^created: \d{4}-\d{2}-\d{2}$/m)
      expect(text).toMatch(/^priority: 1$/m)
      expect(text).toMatch(/^tags: \[不具合, 仕事\]$/m)
      expect(text).toMatch(/^assignee: 高橋$/m) // テンプレートの値のまま
      expect(text).toMatch(/^author: 山田$/m)
      expect(text).toMatch(/^start: \d{4}-\d{2}-\d{2}$/m)
      expect(text).toMatch(/\n## 再現手順\n$/)
      // 何も変えずに閉じたら削除する
      expect(await s.discardIfEmpty(fileName)).toBe(true)
    })

    it('一覧にないテンプレートの名前は受け付けない（フォルダの外のファイルを読ませない）', async () => {
      writeFileSync(join(tasksDir, 'secret.md'), '---\nid:\n---\n')
      const s = await startStore()
      await expect(s.createTicket('', [], '../../secret')).rejects.toThrow('見つかりません')
      await expect(s.createNote('', { template: '議事メモ' })).rejects.toThrow('見つかりません')
    })

    it('frontmatter のないテンプレートは、分かる文で知らせる', async () => {
      mkdirSync(join(tasksDir, 'templates', 'notes'), { recursive: true })
      writeFileSync(join(tasksDir, 'templates', 'notes', '白紙.md'), '# \n')
      const s = await startStore()
      await expect(s.createNote('', { template: '白紙' })).rejects.toThrow('frontmatter')
    })

    it('既定の NOTE_TEMPLATE.md は記録のメモ。日付に今日・作成者に自分を入れる', async () => {
      const s = await startStore()
      const key = await s.createNote('山田')
      expect(key).toMatch(/^notes\/\d{8}-\d{4}-[a-z0-9]{4}\.md$/)
      const text = read(key)
      expect(text).toMatch(/^type: record$/m)
      expect(text).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m)
      expect(text).toMatch(/^author: 山田$/m)
      expect(text).not.toMatch(/^reviewed:/m)
      expect(s.getState().notes[0]).toMatchObject({ type: 'record', folder: '' })
    })

    it('知識のテンプレートで作ると、見直した日にも今日を入れる', async () => {
      const s = await startStore()
      await s.initFolder()
      const key = await s.createNote('', { template: '手順' })
      const text = read(key)
      const today = /^created: (\S+)$/m.exec(text)![1]
      expect(text).toMatch(/^type: knowledge$/m)
      expect(text).toMatch(new RegExp(`^reviewed: ${today}$`, 'm'))
      expect(text).toMatch(/\n## 手順\n/)
      expect(await s.discardIfEmpty(key)).toBe(true)
    })

    it('見本はないときだけ置き、手で直したものは「違う」にせず、置き換えない', async () => {
      const s = await startStore()
      const sample = SAMPLE_TEMPLATES[0].name
      expect((await s.checkRuleFiles()).find((f) => f.name === sample)).toEqual({
        name: sample,
        state: 'missing',
        sample: true
      })
      await s.updateRuleFiles([sample])
      expect(readFileSync(join(tasksDir, sample), 'utf8')).toBe(SAMPLE_TEMPLATES[0].content)

      writeFileSync(join(tasksDir, sample), '---\nid:\n---\n\n# 自分で直した\n')
      expect((await s.checkRuleFiles()).find((f) => f.name === sample)?.state).toBe('same')
      await s.updateRuleFiles([sample])
      expect(readFileSync(join(tasksDir, sample), 'utf8')).toBe('---\nid:\n---\n\n# 自分で直した\n')
    })
  })

  describe('ノートのフォルダ', () => {
    it('notes/ の下のフォルダの中のノートも読み、隠しフォルダは読まない', async () => {
      mkdirSync(join(notesDir, '案件A', '定例'), { recursive: true })
      mkdirSync(join(notesDir, '.sync'), { recursive: true })
      mkdirSync(join(notesDir, '空のフォルダ'), { recursive: true })
      writeFileSync(join(notesDir, '20261101-0900-aaaa.md'), noteText('20261101-0900-aaaa', '直下'))
      writeFileSync(
        join(notesDir, '案件A', '定例', '20261101-0900-bbbb.md'),
        noteText('20261101-0900-bbbb', '定例')
      )
      writeFileSync(join(notesDir, '.sync', '20261101-0900-cccc.md'), noteText('x', '隠し'))
      await startStore()
      expect(latest!.notes.map((n) => [n.fileName, n.folder, n.title])).toEqual([
        ['notes/20261101-0900-aaaa.md', '', '直下'],
        ['notes/案件A/定例/20261101-0900-bbbb.md', '案件A/定例', '定例']
      ])
      expect(latest!.noteFolders).toEqual(['案件A', '案件A/定例', '空のフォルダ'])
      // フォルダの中のノートも読み書きできる
      const key = 'notes/案件A/定例/20261101-0900-bbbb.md'
      const before = (await store!.readTicket(key))!
      expect(await store!.saveTicket(key, before, before.replace('# 定例', '# 定例会'))).toEqual({
        status: 'saved',
        text: before.replace('# 定例', '# 定例会')
      })
    })

    it(`フォルダは notes/ から ${MAX_NOTE_FOLDER_DEPTH} 段まで読み、作る`, async () => {
      const levels = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i + 1}`)
      mkdirSync(join(notesDir, ...levels(MAX_NOTE_FOLDER_DEPTH + 1)), { recursive: true })
      writeFileSync(
        join(notesDir, ...levels(MAX_NOTE_FOLDER_DEPTH), '20261101-0900-aaaa.md'),
        noteText('20261101-0900-aaaa', '一番深い')
      )
      writeFileSync(
        join(notesDir, ...levels(MAX_NOTE_FOLDER_DEPTH + 1), '20261101-0900-bbbb.md'),
        noteText('20261101-0900-bbbb', '深すぎる')
      )
      const s = await startStore()
      expect(s.getState().notes.map((n) => n.title)).toEqual(['一番深い'])
      expect(s.getState().noteFolders).toHaveLength(MAX_NOTE_FOLDER_DEPTH)
      await expect(
        s.createNoteFolder(levels(MAX_NOTE_FOLDER_DEPTH).join('/'), 'もう1段')
      ).rejects.toThrow(`${MAX_NOTE_FOLDER_DEPTH}段まで`)
    })

    it('外部で作ったフォルダとノート、消したフォルダに追従する', async () => {
      mkdirSync(notesDir)
      await startStore()
      mkdirSync(join(notesDir, '案件B', '設計'), { recursive: true })
      writeFileSync(
        join(notesDir, '案件B', '設計', '20261101-0900-dddd.md'),
        noteText('20261101-0900-dddd', '設計メモ')
      )
      await waitFor(() => latest!.notes.some((n) => n.title === '設計メモ'))
      await waitFor(() => latest!.noteFolders.includes('案件B/設計'))
      expect(latest!.notes[0].folder).toBe('案件B/設計')

      rmSync(join(notesDir, '案件B'), { recursive: true })
      await waitFor(() => latest!.notes.length === 0 && latest!.noteFolders.length === 0)
    })

    it('一覧にないキーや notes/ の外を指すキーのパスは返さない', async () => {
      await startStore()
      expect(() => store!.ticketPath('notes/../RULES.md')).toThrow()
      expect(() => store!.ticketPath('notes/案件A/../../x.md')).toThrow()
      await expect(store!.readTicket('notes/../tickets/x.md')).resolves.toBeNull()
    })

    it('フォルダを作り、その中にノートを作る。名前の決まりに合わないフォルダは作らない', async () => {
      const s = await startStore()
      expect(await s.createNoteFolder('', ' 案件C ')).toBe('案件C')
      expect(await s.createNoteFolder('案件C', '定例')).toBe('案件C/定例')
      expect(existsSync(join(notesDir, '案件C', '定例'))).toBe(true)
      expect(s.getState().noteFolders).toEqual(['案件C', '案件C/定例'])

      const key = await s.createNote('', { folder: '案件C/定例' })
      expect(key).toMatch(/^notes\/案件C\/定例\/\d{8}-\d{4}-[a-z0-9]{4}\.md$/)
      expect(existsSync(join(tasksDir, key))).toBe(true)

      await expect(s.createNoteFolder('', '案件C')).rejects.toThrow('同じ名前')
      await expect(s.createNoteFolder('', '../外')).rejects.toThrow('使えません')
      await expect(s.createNoteFolder('', '.隠し')).rejects.toThrow('「.」')
      await expect(s.createNoteFolder('ない', 'x')).rejects.toThrow('見つかりません')
      await expect(s.createNote('', { folder: 'ない' })).rejects.toThrow('見つかりません')
    })

    it('ノートを別のフォルダに移す（名前は変えない）。移す先に同じ名前があれば移さない', async () => {
      mkdirSync(join(notesDir, '案件A'), { recursive: true })
      mkdirSync(join(notesDir, '共通'), { recursive: true })
      const name = '20261101-0900-aaaa_手順.md'
      writeFileSync(join(notesDir, name), noteText('20261101-0900-aaaa', '手順'))
      const s = await startStore()

      expect(await s.moveNote(`notes/${name}`, '案件A')).toEqual({
        [`notes/${name}`]: `notes/案件A/${name}`
      })
      expect(existsSync(join(notesDir, '案件A', name))).toBe(true)
      expect(s.getState().notes.map((n) => n.fileName)).toEqual([`notes/案件A/${name}`])
      expect(await s.moveNote(`notes/案件A/${name}`, '案件A')).toEqual({})

      writeFileSync(join(notesDir, '共通', name), noteText('20261101-0900-zzzz', '別のもの'))
      await expect(s.moveNote(`notes/案件A/${name}`, '共通')).rejects.toThrow('同じ名前')
      await expect(s.moveNote(`notes/案件A/${name}`, 'ない')).rejects.toThrow('見つかりません')
      expect(await s.moveNote(`notes/案件A/${name}`, '')).toEqual({
        [`notes/案件A/${name}`]: `notes/${name}`
      })
    })

    it('フォルダの中のノートから起こしたチケットに、プロジェクトのタグを付け、リンクの深さを合わせる', async () => {
      mkdirSync(join(notesDir, '案件A', '定例'), { recursive: true })
      const key = 'notes/案件A/定例/20261101-0900-aaaa.md'
      const text = noteText('20261101-0900-aaaa', '定例') + '\n## 宿題\n\n- 見積書を送る\n'
      writeFileSync(join(tasksDir, key), text)
      const s = await startStore()

      const result = await s.createTicketFromNote(key, text, '見積書を送る', '', {
        homeworkItem: '見積書を送る'
      })
      expect(result.status).toBe('created')
      if (result.status !== 'created') return
      expect(read(result.fileName)).toMatch(/^tags: \[定例, 案件A\]$/m)
      const id = result.fileName.slice(0, 18)
      expect(result.noteText).toContain(
        `- 見積書を送る → [${id}](../../../tickets/${result.fileName})`
      )
    })

    it('共通/ のノートからは、フォルダ名のタグを付けない', async () => {
      mkdirSync(join(notesDir, '共通'), { recursive: true })
      const key = 'notes/共通/20261101-0900-aaaa.md'
      const text = noteText('20261101-0900-aaaa', '手順')
      writeFileSync(join(tasksDir, key), text)
      const s = await startStore()
      const result = await s.createTicketFromNote(key, text, '手順を直す')
      expect(result.status).toBe('created')
      if (result.status === 'created') expect(read(result.fileName)).toMatch(/^tags: \[定例\]$/m)
    })

    it('「宿題」の見出しがないノートには書き戻さない', async () => {
      mkdirSync(notesDir)
      const key = 'notes/20261101-0900-aaaa.md'
      const text =
        noteText('20261101-0900-aaaa', '手順', 'type: knowledge\n') + '\n## 手順\n\n1. x\n'
      writeFileSync(join(tasksDir, key), text)
      const s = await startStore()
      const result = await s.createTicketFromNote(key, text, '手順を直す')
      expect(result).toMatchObject({ status: 'created', noteText: text })
      expect(readFileSync(join(tasksDir, key), 'utf8')).toBe(text)
      if (result.status === 'created') {
        expect(read(result.fileName)).toMatch(/^source: 20261101-0900-aaaa$/m)
      }
    })

    it('起動時の見出しの付け足しは、フォルダの中のノートにもかける', async () => {
      mkdirSync(join(notesDir, '案件A'), { recursive: true })
      writeFileSync(
        join(notesDir, '案件A', '20261101-0900-aaaa.md'),
        noteText('20261101-0900-aaaa', '定例')
      )
      const s = await startStore()
      expect(await s.renameUntitledFiles('')).toBe(1)
      expect(existsSync(join(notesDir, '案件A', '20261101-0900-aaaa_定例.md'))).toBe(true)
      expect(s.getState().notes.map((n) => n.fileName)).toEqual([
        'notes/案件A/20261101-0900-aaaa_定例.md'
      ])
    })
  })

  describe('点検と被リンク', () => {
    beforeEach(() => {
      mkdirSync(join(notesDir, '案件A'), { recursive: true })
      mkdirSync(join(notesDir, '共通'), { recursive: true })
      // 共通/ の手順を、案件A の議事メモが同じフォルダにあるつもりのリンク（移した後）で指している
      writeFileSync(
        join(notesDir, '案件A', '20261101-0900-mt01_定例.md'),
        `${noteText('20261101-0900-mt01', '定例')}\n- [手順](20261101-0900-kn01_手順.md) を見る\n- [手順](20261101-0900-kn01_手順.md) もう一度\n`
      )
      writeFileSync(
        join(notesDir, '共通', '20261101-0900-kn01_手順.md'),
        noteText('20261101-0900-kn01', '手順', 'type: knowledge\nreviewed:\n')
      )
      writeFileSync(
        join(tasksDir, 'tickets', '20261101-0900-t001.md'),
        '---\nid: 20261101-0900-t001\nstatus: todo\ncreated: 2026-11-01\n---\n\n# 見積\n\n20261101-0900-kn01 の手順で\n'
      )
    })

    it('ファイルを読んで点検し、ファイルには何も書かない', async () => {
      const s = await startStore()
      const before = read('notes/案件A/20261101-0900-mt01_定例.md')
      const items = await s.lint('2026-11-10')
      expect(items.map((i) => `${i.kind}:${i.fileName ?? i.title}`)).toEqual([
        'shifted-link:notes/案件A/20261101-0900-mt01_定例.md',
        'no-index:案件A',
        'unreviewed:notes/共通/20261101-0900-kn01_手順.md'
      ])
      expect(read('notes/案件A/20261101-0900-mt01_定例.md')).toBe(before)
    })

    it('被リンクは、本文のリンクと ID で指しているファイル', async () => {
      const s = await startStore()
      expect(await s.backlinks('notes/共通/20261101-0900-kn01_手順.md')).toEqual([
        { fileName: '20261101-0900-t001.md', title: '見積' },
        { fileName: 'notes/案件A/20261101-0900-mt01_定例.md', title: '定例' }
      ])
      expect(await s.backlinks('notes/ない.md')).toEqual([])
    })

    it('「直す」は、そのリンク先のリンクだけを今のファイルへの相対パスに書き換える', async () => {
      const s = await startStore()
      const key = 'notes/案件A/20261101-0900-mt01_定例.md'
      const before = read(key)
      await s.fixLink(key, '20261101-0900-kn01_手順.md')
      expect(read(key)).toBe(
        before.replaceAll('(20261101-0900-kn01_手順.md)', '(../共通/20261101-0900-kn01_手順.md)')
      )
      expect((await s.lint('2026-11-10')).some((i) => i.kind === 'shifted-link')).toBe(false)
      // もう一度押しても、直すリンクがないので書き換えない
      await expect(s.fixLink(key, '20261101-0900-kn01_手順.md')).rejects.toThrow(
        'リンクが見つかりません'
      )
      await expect(s.fixLink(key, '20261101-0900-zzzz.md')).rejects.toThrow('リンク先')
    })
  })
})
