import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../shared/api'
import { findWarnings } from '../shared/ticket'
import { TaskStore } from './taskStore'

const template = readFileSync(join(__dirname, '../../templates/TEMPLATE.md'), 'utf8')

function ticketText(id: string, title: string): string {
  return `---\nid: ${id}\nstatus: todo\n---\n\n# ${title}\n`
}

/** 条件を満たすまで待つ（ファイル監視は非同期なので） */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('時間内に条件を満たしませんでした')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('TaskStore', () => {
  let tasksDir: string
  let ticketsDir: string
  let store: TaskStore | null
  let latest: AppState | null

  beforeEach(() => {
    tasksDir = mkdtempSync(join(tmpdir(), 'mokkan-test-'))
    ticketsDir = join(tasksDir, 'tickets')
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

  const titles = (): string[] => (latest?.tickets ?? []).map((t) => t.title).sort()

  it('フォルダの状態を判定する', async () => {
    expect((await startStore()).getState().folderStatus).toBe('not-initialized')
    await store!.stop()

    store = new TaskStore(join(tasksDir, 'nothing'), () => {})
    await store.start()
    expect(store.getState().folderStatus).toBe('missing')
    await store.stop()

    store = new TaskStore(null, () => {})
    await store.start()
    expect(store.getState().folderStatus).toBe('unset')
  })

  it('準備すると tickets/ と原本を置き、既存のファイルは変えない', async () => {
    writeFileSync(join(tasksDir, 'RULES.md'), '自分で直したルール\n')
    const s = await startStore()
    await s.initFolder()
    expect(readdirSync(tasksDir).sort()).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'NOTE_TEMPLATE.md',
      'RULES.md',
      'TEMPLATE.md',
      'tickets'
    ])
    expect(readFileSync(join(tasksDir, 'RULES.md'), 'utf8')).toBe('自分で直したルール\n')
    expect(readFileSync(join(tasksDir, 'TEMPLATE.md'), 'utf8')).toBe(template)
  })

  it('起動時に md だけを読み込む（隠しファイルや md 以外は無視）', async () => {
    mkdirSync(ticketsDir)
    writeFileSync(join(ticketsDir, '20261018-1356-aaaa.md'), ticketText('20261018-1356-aaaa', 'A'))
    writeFileSync(join(ticketsDir, '.hidden.md'), ticketText('x', '隠し'))
    writeFileSync(join(ticketsDir, 'memo.txt'), 'x')
    await startStore()
    expect(titles()).toEqual(['A'])
  })

  it('ファイルの更新日時を読む', async () => {
    mkdirSync(ticketsDir)
    const path = join(ticketsDir, '20261018-1356-aaaa.md')
    writeFileSync(path, ticketText('20261018-1356-aaaa', 'A'))
    const when = new Date('2026-10-19T12:34:00')
    utimesSync(path, when, when)
    await startStore()
    expect(latest?.tickets[0].modified).toBe(when.getTime())
  })

  it('外部からの追加・変更・削除に追従する', async () => {
    mkdirSync(ticketsDir)
    await startStore()
    const path = join(ticketsDir, '20261018-1356-aaaa_メモ.md')

    writeFileSync(path, ticketText('20261018-1356-aaaa', '追加'))
    await waitFor(() => titles().includes('追加'))

    writeFileSync(path, ticketText('20261018-1356-aaaa', '変更'))
    await waitFor(() => titles().includes('変更'))
    expect(titles()).toEqual(['変更'])

    writeFileSync(join(ticketsDir, 'memo.txt'), 'x')
    rmSync(path)
    await waitFor(() => titles().length === 0)
  })

  it('TEMPLATE.md から id と created だけを入れて作る', async () => {
    mkdirSync(ticketsDir)
    writeFileSync(join(tasksDir, 'TEMPLATE.md'), template.replace('priority: 2', 'priority: 3'))
    const s = await startStore()

    const fileName = await s.createTicket()
    const id = fileName.replace(/\.md$/, '')
    expect(id).toMatch(/^\d{8}-\d{4}-[a-z0-9]{4}$/)

    const text = readFileSync(join(ticketsDir, fileName), 'utf8')
    expect(text).toMatch(new RegExp(`^id: ${id}$`, 'm'))
    expect(text).toMatch(/^created: \d{4}-\d{2}-\d{2}$/m)
    expect(text).toMatch(/^priority: 3$/m) // フォルダの TEMPLATE.md を使う
    expect(s.getState().tickets.map((t) => t.id)).toEqual([id])
  })

  it('作成者と担当者に自分の名前を入れる（author の行がない古いテンプレートでも足す）', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    const withLine = readFileSync(join(ticketsDir, await s.createTicket('山田')), 'utf8')
    expect(withLine).toMatch(/^assignee: 山田\nauthor: 山田\ncreated: /m)

    writeFileSync(join(tasksDir, 'TEMPLATE.md'), template.replace('author:\n', ''))
    const old = readFileSync(join(ticketsDir, await s.createTicket('山田')), 'utf8')
    expect(old).toMatch(/^assignee: 山田\nauthor: 山田\ncreated: /m)

    const unnamed = readFileSync(join(ticketsDir, await s.createTicket()), 'utf8')
    expect(unnamed).not.toMatch(/^author: \S/m)
    expect(unnamed).toMatch(/^assignee:$/m)
  })

  it('新規作成では、着手日に今日・タグに渡したタグを入れ、期限は空のまま', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    const fileName = await s.createTicket('山田', ['仕事'])
    const text = readFileSync(join(ticketsDir, fileName), 'utf8')
    const today = /^created: (\S+)$/m.exec(text)![1]
    expect(text).toMatch(new RegExp(`^start: ${today}$`, 'm'))
    expect(text).toMatch(/^due:$/m)
    expect(text).toMatch(/^tags: \[仕事\]$/m)
    expect(text).toMatch(/^status: todo$/m)
    expect(text).toMatch(/^priority: 2$/m)
    // 初めの値が入っていても、何も変えずに閉じたら削除する
    expect(await s.discardIfEmpty(fileName)).toBe(true)
  })

  it('完了した繰り返しのチケットの次回分を作り、二重には作らない', async () => {
    mkdirSync(ticketsDir)
    const fileName = '20261019-0900-aaaa.md'
    const doneText = template
      .replace('id:', 'id: 20261019-0900-aaaa')
      .replace('status: todo', 'status: done')
      .replace('due:', 'due: 2026-10-23')
      .replace('repeat:', 'repeat: weekly:fri')
      .replace('done:', 'done: 2026-10-23')
      .replace(/\n#\n$/, '\n# 週報を送る\n\n- メモ\n')
    writeFileSync(join(ticketsDir, fileName), doneText)
    const s = await startStore()

    const result = await s.createNextRepeat(fileName, '山田')
    expect(result).toMatchObject({ status: 'created', due: '2026-10-30', start: null })
    const created = result.status === 'created' ? result.fileName : ''
    const text = readFileSync(join(ticketsDir, created), 'utf8')
    expect(text).toMatch(/^status: todo$/m)
    expect(text).toMatch(/^due: 2026-10-30$/m)
    expect(text).toMatch(/^repeat: weekly:fri$/m)
    expect(text).toMatch(/^author: 山田$/m)
    expect(text).toMatch(/\n# 週報を送る\n$/)

    // 完了を取り消してもう一度完了しても、同じ次回分は作らない
    expect(await s.createNextRepeat(fileName, '山田')).toEqual({
      status: 'exists',
      fileName: created
    })
    expect(readdirSync(ticketsDir)).toHaveLength(2)
  })

  it('ほぼ同時に2回呼ばれても、次回分は1件だけ作る', async () => {
    mkdirSync(ticketsDir)
    writeFileSync(
      join(ticketsDir, '20261019-0900-aaaa.md'),
      template
        .replace('id:', 'id: 20261019-0900-aaaa')
        .replace('status: todo', 'status: done')
        .replace('due:', 'due: 2026-10-23')
        .replace('repeat:', 'repeat: daily')
        .replace('done:', 'done: 2026-10-23')
    )
    const s = await startStore()
    const results = await Promise.all([
      s.createNextRepeat('20261019-0900-aaaa.md'),
      s.createNextRepeat('20261019-0900-aaaa.md')
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'exists'])
    expect(readdirSync(ticketsDir)).toHaveLength(2)
  })

  it('完了していない・繰り返しがないチケットでは次回分を作らない', async () => {
    mkdirSync(ticketsDir)
    writeFileSync(
      join(ticketsDir, '20261019-0900-aaaa.md'),
      template.replace('id:', 'id: 20261019-0900-aaaa').replace('repeat:', 'repeat: daily')
    )
    writeFileSync(
      join(ticketsDir, '20261019-0900-bbbb.md'),
      template.replace('id:', 'id: 20261019-0900-bbbb').replace('status: todo', 'status: done')
    )
    const s = await startStore()
    expect(await s.createNextRepeat('20261019-0900-aaaa.md')).toEqual({ status: 'none' })
    expect(await s.createNextRepeat('20261019-0900-bbbb.md')).toEqual({ status: 'none' })
    expect(await s.createNextRepeat('nothing.md')).toEqual({ status: 'none' })
  })

  it('TEMPLATE.md がなければ同梱の原本で作る', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    const fileName = await s.createTicket()
    expect(readFileSync(join(ticketsDir, fileName), 'utf8')).toMatch(/^priority: 2$/m)
  })

  it('最後に読んだ内容と同じときだけ保存する', async () => {
    mkdirSync(ticketsDir)
    const fileName = '20261018-1356-aaaa.md'
    const path = join(ticketsDir, fileName)
    const base = ticketText('20261018-1356-aaaa', 'A')
    writeFileSync(path, base)
    const s = await startStore()

    const saved = await s.saveTicket(fileName, base, ticketText('20261018-1356-aaaa', 'B'))
    expect(saved).toEqual({ status: 'saved', text: ticketText('20261018-1356-aaaa', 'B') })
    expect(readFileSync(path, 'utf8')).toBe(ticketText('20261018-1356-aaaa', 'B'))

    // 古い内容をもとにした保存は、外部の変更とみなして書き込まない
    const conflict = await s.saveTicket(fileName, base, ticketText('20261018-1356-aaaa', 'C'))
    expect(conflict).toEqual({ status: 'conflict', text: ticketText('20261018-1356-aaaa', 'B') })
    expect(readFileSync(path, 'utf8')).toBe(ticketText('20261018-1356-aaaa', 'B'))

    // 「自分の変更を残す」を選んだときは上書きする
    await s.saveTicket(fileName, base, ticketText('20261018-1356-aaaa', 'C'), true)
    expect(readFileSync(path, 'utf8')).toBe(ticketText('20261018-1356-aaaa', 'C'))
  })

  it('なくなったファイルは保存しない', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    expect(await s.saveTicket('20261018-1356-aaaa.md', 'a', 'b')).toEqual({ status: 'missing' })
    expect(readdirSync(ticketsDir)).toEqual([])
  })

  describe('アーカイブと削除', () => {
    /** 完了したチケットのファイルを書く */
    function writeDone(dir: string, id: string, parent = '', status = 'done'): void {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, `${id}.md`),
        template
          .replace('id:', `id: ${id}`)
          .replace('status: todo', `status: ${status}`)
          .replace('parent:', parent ? `parent: ${parent}` : 'parent:')
          .replace('done:', status === 'done' ? 'done: 2026-09-01' : 'done:')
      )
    }

    it('archive/ も読み込み、tasks/ 直下の md（RULES.md など）は読まない', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(join(tasksDir, 'archive'), '20261019-0900-bbbb')
      writeFileSync(join(tasksDir, 'RULES.md'), '# ルール\n')
      await startStore()
      expect(latest?.tickets.map((t) => [t.fileName, t.archived])).toEqual([
        ['20261019-0900-aaaa.md', false],
        ['archive/20261019-0900-bbbb.md', true]
      ])
      expect(store!.ticketPath('archive/20261019-0900-bbbb.md')).toBe(
        join(tasksDir, 'archive', '20261019-0900-bbbb.md')
      )
    })

    it('完了したチケットを子孫と一緒に archive/ に移し、戻せる', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(ticketsDir, '20261019-0900-bbbb', '20261019-0900-aaaa')
      const s = await startStore()

      expect(await s.archiveTicket('20261019-0900-aaaa.md')).toEqual({
        '20261019-0900-aaaa.md': 'archive/20261019-0900-aaaa.md',
        '20261019-0900-bbbb.md': 'archive/20261019-0900-bbbb.md'
      })
      expect(readdirSync(ticketsDir)).toEqual([])
      expect(readdirSync(join(tasksDir, 'archive')).sort()).toEqual([
        '20261019-0900-aaaa.md',
        '20261019-0900-bbbb.md'
      ])
      await waitFor(() => latest?.tickets.every((t) => t.archived) === true)

      expect(await s.restoreTicket('archive/20261019-0900-aaaa.md')).toEqual({
        'archive/20261019-0900-aaaa.md': '20261019-0900-aaaa.md',
        'archive/20261019-0900-bbbb.md': '20261019-0900-bbbb.md'
      })
      expect(readdirSync(ticketsDir).sort()).toEqual([
        '20261019-0900-aaaa.md',
        '20261019-0900-bbbb.md'
      ])
    })

    it('未完了の子孫があればアーカイブしない', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(ticketsDir, '20261019-0900-bbbb', '20261019-0900-aaaa', 'todo')
      const s = await startStore()
      await expect(s.archiveTicket('20261019-0900-aaaa.md')).rejects.toThrow('未完了の子チケット')
      expect(readdirSync(ticketsDir)).toHaveLength(2)
    })

    it('完了から日数がたったものをまとめてアーカイブする', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(ticketsDir, '20261019-0900-bbbb', '', 'todo')
      const s = await startStore()
      expect(await s.archiveDoneBefore('2026-09-18')).toEqual({
        '20261019-0900-aaaa.md': 'archive/20261019-0900-aaaa.md'
      })
      expect(readdirSync(ticketsDir)).toEqual(['20261019-0900-bbbb.md'])
    })

    it('tickets/ と archive/ に同じ ID のファイルがあれば、重複として警告する', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(join(tasksDir, 'archive'), '20261019-0900-aaaa')
      await startStore()
      const warnings = findWarnings(latest!.tickets)
      expect(warnings.map((w) => w.kind)).toEqual(['duplicate-id'])
      expect(warnings[0].fileNames.sort()).toEqual([
        '20261019-0900-aaaa.md',
        'archive/20261019-0900-aaaa.md'
      ])
    })

    it('移す先に同じ名前のファイルがあれば、どれも移さない', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa')
      writeDone(join(tasksDir, 'archive'), '20261019-0900-aaaa')
      const s = await startStore()
      await expect(s.archiveTicket('20261019-0900-aaaa.md')).rejects.toThrow('同じ名前のファイル')
    })

    it('削除は子孫と一緒にごみ箱に移す（ごみ箱がなければ削除しない）', async () => {
      writeDone(ticketsDir, '20261019-0900-aaaa', '', 'todo')
      writeDone(ticketsDir, '20261019-0900-bbbb', '20261019-0900-aaaa', 'todo')
      writeDone(ticketsDir, '20261019-0900-cccc', '', 'todo')
      const trashed: string[] = []
      store = new TaskStore(tasksDir, (state) => (latest = state), {
        trash: async (path) => {
          trashed.push(path)
          rmSync(path)
        }
      })
      await store.start()
      expect(await store.deleteTicket('20261019-0900-aaaa.md')).toBe(2)
      expect(trashed.sort()).toEqual([
        join(ticketsDir, '20261019-0900-aaaa.md'),
        join(ticketsDir, '20261019-0900-bbbb.md')
      ])
      expect(store.getState().tickets.map((t) => t.fileName)).toEqual(['20261019-0900-cccc.md'])

      const noTrash = new TaskStore(tasksDir, () => {})
      await noTrash.start()
      await expect(noTrash.deleteTicket('20261019-0900-cccc.md')).rejects.toThrow('ごみ箱')
      await noTrash.stop()
    })
  })

  it('作ったばかりで空のままのチケットだけを削除する', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    const empty = await s.createTicket()
    const titled = await s.createTicket()
    const changed = await s.createTicket()
    const other = '20261018-1356-aaaa.md'
    writeFileSync(join(ticketsDir, other), template.replace('id:', 'id: 20261018-1356-aaaa'))
    await waitFor(() => latest?.tickets.length === 4)

    const read = (f: string): string => readFileSync(join(ticketsDir, f), 'utf8')
    await s.saveTicket(titled, read(titled), read(titled).replace(/^#$/m, '# タイトル'))
    await s.saveTicket(changed, read(changed), read(changed).replace('priority: 2', 'priority: 1'))

    expect(await s.discardIfEmpty(empty)).toBe(true)
    expect(await s.discardIfEmpty(titled)).toBe(false) // タイトルを書いた
    expect(await s.discardIfEmpty(changed)).toBe(false) // 項目を変えた
    expect(await s.discardIfEmpty(other)).toBe(false) // このアプリが作っていない
    expect(readdirSync(ticketsDir).sort()).toEqual([changed, other, titled].sort())
  })

  it('一覧にないファイルのパスは返さない', async () => {
    mkdirSync(ticketsDir)
    const s = await startStore()
    expect(() => s.ticketPath('../RULES.md')).toThrow()
    expect(() => s.ticketPath('20261018-1356-aaaa.md')).toThrow()
    expect(() => s.ticketPath('notes/../RULES.md')).toThrow()
  })

  describe('ノート', () => {
    let notesDir: string
    const noteTemplate = readFileSync(join(__dirname, '../../templates/NOTE_TEMPLATE.md'), 'utf8')

    beforeEach(() => {
      notesDir = join(tasksDir, 'notes')
      mkdirSync(ticketsDir)
    })

    function noteText(id: string, title: string, extra = ''): string {
      return `---\nid: ${id}\ndate: 2026-10-19\ntags: [A社]\nauthor:\ncreated: 2026-10-19\n---\n\n# ${title}\n${extra}`
    }

    it('notes/ を読み込み、チケットとは別に持つ', async () => {
      mkdirSync(notesDir)
      writeFileSync(
        join(notesDir, '20261019-1400-m3k8_定例.md'),
        noteText('20261019-1400-m3k8', '定例')
      )
      writeFileSync(join(notesDir, 'memo.txt'), 'md 以外は読まない')
      writeFileSync(
        join(ticketsDir, '20261019-1500-aaaa.md'),
        ticketText('20261019-1500-aaaa', 'A')
      )
      const s = await startStore()
      const state = s.getState()
      expect(state.tickets.map((t) => t.fileName)).toEqual(['20261019-1500-aaaa.md'])
      expect(state.notes.map((n) => [n.fileName, n.title, n.date, n.tags])).toEqual([
        ['notes/20261019-1400-m3k8_定例.md', '定例', '2026-10-19', ['A社']]
      ])
      expect(await s.readTicket('notes/20261019-1400-m3k8_定例.md')).toContain('# 定例')
    })

    it('後から作られた notes/ の追加・変更・削除にも追従する', async () => {
      await startStore()
      mkdirSync(notesDir)
      const path = join(notesDir, '20261019-1400-m3k8.md')
      writeFileSync(path, noteText('20261019-1400-m3k8', '定例'))
      await waitFor(() => latest?.notes.length === 1)
      writeFileSync(path, noteText('20261019-1400-m3k8', '定例（直した）'))
      await waitFor(() => latest?.notes[0]?.title === '定例（直した）')
      rmSync(path)
      await waitFor(() => latest?.notes.length === 0)
    })

    it('NOTE_TEMPLATE.md からノートを作り、会議の日に今日・作成者に自分の名前を入れる', async () => {
      const s = await startStore()
      const key = await s.createNote('山田')
      expect(key).toMatch(/^notes\/\d{8}-\d{4}-[a-z0-9]{4}\.md$/)
      const text = readFileSync(join(tasksDir, key), 'utf8')
      const id = key.slice('notes/'.length, -'.md'.length)
      const today = s.getState().notes[0].created
      expect(text).toBe(
        noteTemplate
          .replace('id:', `id: ${id}`)
          .replace('date:', `date: ${today}`)
          .replace('author:', 'author: 山田')
          .replace('created:', `created: ${today}`)
      )
    })

    it('作ったばかりでテンプレートのままのノートだけを削除する', async () => {
      const s = await startStore()
      const untouched = await s.createNote()
      const written = await s.createNote()
      const path = join(tasksDir, written)
      const before = readFileSync(path, 'utf8')
      await s.saveTicket(written, before, before.replace(/^#$/m, '# 定例'))

      expect(await s.discardIfEmpty(untouched)).toBe(true)
      expect(await s.discardIfEmpty(written)).toBe(false)
      expect(readdirSync(notesDir)).toEqual([written.slice('notes/'.length)])
    })

    it('ノートを削除しても、起こしたチケットは残す', async () => {
      mkdirSync(notesDir)
      writeFileSync(join(notesDir, '20261019-1400-m3k8.md'), noteText('20261019-1400-m3k8', '定例'))
      writeFileSync(
        join(ticketsDir, '20261019-1500-aaaa.md'),
        '---\nid: 20261019-1500-aaaa\nstatus: todo\nsource: 20261019-1400-m3k8\n---\n\n# A\n'
      )
      const trashed: string[] = []
      store = new TaskStore(tasksDir, (state) => (latest = state), {
        trash: async (path) => {
          trashed.push(path)
          rmSync(path)
        }
      })
      await store.start()
      expect(await store.deleteTicket('notes/20261019-1400-m3k8.md')).toBe(1)
      expect(trashed).toEqual([join(notesDir, '20261019-1400-m3k8.md')])
      expect(store.getState().tickets.map((t) => t.fileName)).toEqual(['20261019-1500-aaaa.md'])
    })

    it('ID はチケットとノートをまたいで重なりを警告する', async () => {
      mkdirSync(notesDir)
      writeFileSync(join(notesDir, '20261019-1400-m3k8.md'), noteText('20261019-1400-m3k8', '定例'))
      writeFileSync(
        join(ticketsDir, '20261019-1400-m3k8.md'),
        ticketText('20261019-1400-m3k8', 'A')
      )
      const state = (await startStore()).getState()
      expect(findWarnings(state.tickets, state.notes).map((w) => w.kind)).toEqual(['duplicate-id'])
    })

    describe('ノートからチケットを起こす', () => {
      const noteKey = 'notes/20261019-1400-m3k8.md'
      const body = '\n## 宿題\n- 見積書を送る\n\n## 文字起こし\n高橋: 見積書を送ります\n'

      it('source とタグを入れたチケットを作り、宿題に書き戻す', async () => {
        mkdirSync(notesDir)
        writeFileSync(
          join(notesDir, '20261019-1400-m3k8.md'),
          noteText('20261019-1400-m3k8', '定例', body)
        )
        const s = await startStore()
        const base = (await s.readTicket(noteKey))!
        const result = await s.createTicketFromNote(noteKey, base, '請求書を送る', '山田')
        if (result.status !== 'created') throw new Error('作れませんでした')

        // ファイル名には初めから見出しを付ける（書き戻すリンクが、起動時の名前の付け足しで切れないように）
        expect(result.fileName).toMatch(/^\d{8}-\d{4}-[a-z0-9]{4}_請求書を送る\.md$/)
        const ticket = readFileSync(join(ticketsDir, result.fileName), 'utf8')
        const id = result.fileName.slice(0, 18)
        expect(ticket).toMatch(/^source: 20261019-1400-m3k8$/m)
        expect(ticket).toMatch(/^tags: \[A社\]$/m)
        expect(ticket).toMatch(/^author: 山田$/m)
        expect(ticket).toMatch(/^assignee: 山田$/m)
        expect(ticket).toMatch(/^# 請求書を送る$/m)

        const note = readFileSync(join(notesDir, '20261019-1400-m3k8.md'), 'utf8')
        expect(note).toBe(result.noteText)
        expect(note).toBe(
          base.replace(
            '- 見積書を送る\n',
            `- 見積書を送る\n- 請求書を送る → [${id}](../tickets/${result.fileName})\n`
          )
        )
        await waitFor(() => latest?.tickets.some((t) => t.source === '20261019-1400-m3k8') ?? false)
      })

      it('選んだ「宿題」の項目の行末にリンクを付け、項目の担当者と期限を入れる', async () => {
        mkdirSync(notesDir)
        writeFileSync(
          join(notesDir, '20261019-1400-m3k8.md'),
          noteText(
            '20261019-1400-m3k8',
            '定例',
            body.replace('- 見積書を送る', '- 見積書を送る（高橋）')
          )
        )
        const s = await startStore()
        const base = (await s.readTicket(noteKey))!
        const result = await s.createTicketFromNote(noteKey, base, '見積書を送る', '山田', {
          homeworkItem: '見積書を送る（高橋）',
          assignee: ['高橋'],
          due: '2026-10-30'
        })
        if (result.status !== 'created') throw new Error('作れませんでした')
        const ticket = readFileSync(join(ticketsDir, result.fileName), 'utf8')
        expect(ticket).toMatch(/^assignee: 高橋$/m)
        expect(ticket).toMatch(/^due: 2026-10-30$/m)
        const id = result.fileName.slice(0, 18)
        expect(result.noteText).toBe(
          base.replace(
            '- 見積書を送る（高橋）\n',
            `- 見積書を送る（高橋） → [${id}](../tickets/${result.fileName})\n`
          )
        )

        // 同じ項目でもう一度押したら（すでに → がある）、新しい行を足す
        const again = await s.createTicketFromNote(noteKey, result.noteText, '見積書を送る', '', {
          homeworkItem: '見積書を送る（高橋）'
        })
        if (again.status !== 'created') throw new Error('作れませんでした')
        expect(again.noteText).toContain(`\n- 見積書を送る → [${again.fileName.slice(0, 18)}]`)
      })

      it('ノートが外部で変わっていたら、何も作らない', async () => {
        mkdirSync(notesDir)
        writeFileSync(
          join(notesDir, '20261019-1400-m3k8.md'),
          noteText('20261019-1400-m3k8', '定例', body)
        )
        const s = await startStore()
        const base = (await s.readTicket(noteKey))!
        const result = await s.createTicketFromNote(noteKey, base.replace('定例', '古い'), 'A')
        expect(result).toEqual({ status: 'conflict', text: base })
        expect(readdirSync(ticketsDir)).toEqual([])
      })

      it('チケットを作っている間にノートが変わったら、上書きせずに書き戻せなかったと返す', async () => {
        mkdirSync(notesDir)
        const notePath = join(notesDir, '20261019-1400-m3k8.md')
        writeFileSync(notePath, noteText('20261019-1400-m3k8', '定例', body))
        const s = await startStore()
        const base = (await s.readTicket(noteKey))!
        // チケットを作った直後に、外部でノートを書き換える
        const inner = s as unknown as { writeNewFile: (...args: unknown[]) => Promise<unknown> }
        const original = inner.writeNewFile.bind(s)
        vi.spyOn(inner, 'writeNewFile').mockImplementation(async (...args) => {
          const created = await original(...args)
          writeFileSync(notePath, `${base}外部で足した行\n`)
          return created
        })
        const result = await s.createTicketFromNote(noteKey, base, '請求書を送る')
        if (result.status !== 'not-written-back')
          throw new Error(`結果が違います：${result.status}`)
        expect(result.reason).toContain('外部で変更')
        expect(result.line).toBe(
          `- 請求書を送る → [${result.fileName.slice(0, 18)}](../tickets/${result.fileName})`
        )
        expect(readFileSync(notePath, 'utf8')).toBe(`${base}外部で足した行\n`)
        expect(readdirSync(ticketsDir)).toEqual([result.fileName]) // チケットは残す
      })

      it('ノートに書き込めなかったら、書き戻せなかったと返す', async () => {
        mkdirSync(notesDir)
        const notePath = join(notesDir, '20261019-1400-m3k8.md')
        writeFileSync(notePath, noteText('20261019-1400-m3k8', '定例', body))
        const s = await startStore()
        const base = (await s.readTicket(noteKey))!
        chmodSync(notePath, 0o444) // 読み取り専用にして、書き込みを失敗させる
        try {
          const result = await s.createTicketFromNote(noteKey, base, '請求書を送る')
          expect(result).toMatchObject({ status: 'not-written-back' })
          if (result.status === 'not-written-back') {
            expect(result.reason).toContain('ノートに書き込めませんでした')
          }
          expect(readFileSync(notePath, 'utf8')).toBe(base)
        } finally {
          chmodSync(notePath, 0o644)
        }
      })

      it('ノートでないキーは受け付けない', async () => {
        writeFileSync(
          join(ticketsDir, '20261019-1500-aaaa.md'),
          ticketText('20261019-1500-aaaa', 'A')
        )
        const s = await startStore()
        await expect(s.createTicketFromNote('20261019-1500-aaaa.md', '', 'A')).rejects.toThrow(
          'ノートではありません'
        )
      })
    })
  })

  describe('ルールのファイル', () => {
    it('原本と同じか・違うか・ないかを調べる（改行が CRLF になっただけなら同じとみなす）', async () => {
      mkdirSync(ticketsDir)
      writeFileSync(join(tasksDir, 'RULES.md'), '古いルール\n')
      writeFileSync(join(tasksDir, 'TEMPLATE.md'), template.replace(/\n/g, '\r\n'))
      const s = await startStore()
      expect(await s.checkRuleFiles()).toEqual([
        { name: 'RULES.md', state: 'different' },
        { name: 'TEMPLATE.md', state: 'same' },
        { name: 'NOTE_TEMPLATE.md', state: 'missing' },
        { name: 'CLAUDE.md', state: 'missing' },
        { name: 'AGENTS.md', state: 'missing' }
      ])
    })

    it('ないものは置き、違うものはごみ箱に移してから原本にする', async () => {
      mkdirSync(ticketsDir)
      writeFileSync(join(tasksDir, 'RULES.md'), '古いルール\n')
      writeFileSync(join(tasksDir, 'TEMPLATE.md'), '自分で直したテンプレート\n')
      const trashed: string[] = []
      store = new TaskStore(tasksDir, () => {}, {
        trash: async (path) => {
          trashed.push(path)
          rmSync(path)
        }
      })
      await store.start()
      const result = await store.updateRuleFiles(['RULES.md', 'CLAUDE.md', 'AGENTS.md'])
      expect(trashed).toEqual([join(tasksDir, 'RULES.md')])
      expect(result.map((r) => [r.name, r.state])).toEqual([
        ['RULES.md', 'same'],
        ['TEMPLATE.md', 'different'], // 選ばなかったものは変えない
        ['NOTE_TEMPLATE.md', 'missing'],
        ['CLAUDE.md', 'same'],
        ['AGENTS.md', 'same']
      ])
      expect(readFileSync(join(tasksDir, 'TEMPLATE.md'), 'utf8')).toBe('自分で直したテンプレート\n')
      expect(readFileSync(join(tasksDir, 'CLAUDE.md'), 'utf8')).toBe(
        readFileSync(join(__dirname, '../../templates/AI_GUIDE.md'), 'utf8')
      )
    })

    it('ごみ箱に移してから置くまでに同じ名前のファイルが現れたら、分かる文で知らせる', async () => {
      mkdirSync(ticketsDir)
      writeFileSync(join(tasksDir, 'RULES.md'), '古いルール\n')
      store = new TaskStore(tasksDir, () => {}, {
        trash: async (path) => {
          rmSync(path)
          writeFileSync(path, '同期で現れたファイル\n')
        }
      })
      await store.start()
      await expect(store.updateRuleFiles(['RULES.md'])).rejects.toThrow(
        'RULES.md を置けませんでした。同じ名前のファイルが外部で作られたので、もう一度確かめてください（元のファイルはごみ箱にあります）'
      )
    })

    it('ルールのファイル以外の名前は受け付けない', async () => {
      mkdirSync(ticketsDir)
      const s = await startStore()
      await expect(s.updateRuleFiles(['../secret.md'])).rejects.toThrow(
        'ルールのファイルではありません'
      )
      await expect(s.updateRuleFiles(['RULES.md'])).resolves.toBeDefined() // ないものは置ける
    })
  })

  it('チケット・ノート・アーカイブをまとめて本文から探し、変わったファイルは読み直す', async () => {
    mkdirSync(ticketsDir)
    mkdirSync(join(tasksDir, 'notes'))
    mkdirSync(join(tasksDir, 'archive'))
    writeFileSync(
      join(ticketsDir, '20261020-0900-aaaa.md'),
      ticketText('20261020-0900-aaaa', '見積書を送る')
    )
    writeFileSync(
      join(tasksDir, 'archive', '20261020-0900-bbbb.md'),
      `${ticketText('20261020-0900-bbbb', '去年の件')}\n見積は前回と同じ\n`
    )
    writeFileSync(
      join(tasksDir, 'notes', '20261020-0900-cccc.md'),
      '---\nid: 20261020-0900-cccc\n---\n\n# 定例\n\n## 文字起こし\n見積の話\n'
    )
    const s = await startStore()
    const keys = async (q: string, includeTranscript = false): Promise<string[]> =>
      (await s.search(q, { includeTranscript })).map((h) => h.fileName)
    expect(await keys('見積')).toEqual(['20261020-0900-aaaa.md', 'archive/20261020-0900-bbbb.md'])
    expect((await keys('見積', true)).sort()).toEqual([
      '20261020-0900-aaaa.md',
      'archive/20261020-0900-bbbb.md',
      'notes/20261020-0900-cccc.md'
    ])
    expect(await keys('')).toEqual([])
    writeFileSync(
      join(ticketsDir, '20261020-0900-aaaa.md'),
      ticketText('20261020-0900-aaaa', '請求書を送る')
    )
    await waitFor(() => latest?.tickets.some((t) => t.title === '請求書を送る') ?? false)
    expect(await keys('見積')).toEqual(['archive/20261020-0900-bbbb.md'])
  })

  describe('起動時に ID だけのファイル名に見出しを付ける', () => {
    const file = (id: string, title: string, author = ''): string =>
      `---\nid: ${id}\nstatus: todo\nauthor:${author ? ' ' + author : ''}\n---\n\n# ${title}\n`

    it('tickets/ と notes/ の ID だけの名前に見出しを付け、それ以外は変えない', async () => {
      mkdirSync(ticketsDir)
      mkdirSync(join(tasksDir, 'notes'))
      mkdirSync(join(tasksDir, 'archive'))
      writeFileSync(
        join(ticketsDir, '20261020-0900-aaaa.md'),
        file('20261020-0900-aaaa', '見積書: A社/B社')
      )
      writeFileSync(
        join(ticketsDir, '20261020-0900-bbbb_手で付けた.md'),
        file('20261020-0900-bbbb', '別の見出し')
      )
      writeFileSync(join(ticketsDir, '20261020-0900-cccc.md'), file('20261020-0900-cccc', ''))
      writeFileSync(
        join(ticketsDir, '20261020-0900-dddd.md'),
        file('20261020-0900-dddd', '他の人の', '佐藤')
      )
      writeFileSync(
        join(ticketsDir, '20261020-0900-eeee.md'),
        file('20261020-0900-eeee', '自分の', '山田')
      )
      writeFileSync(
        join(tasksDir, 'archive', '20261020-0900-ffff.md'),
        file('20261020-0900-ffff', 'アーカイブ')
      )
      writeFileSync(
        join(tasksDir, 'notes', '20261020-0900-gggg.md'),
        file('20261020-0900-gggg', 'A社定例')
      )
      // 変える先に同じ名前のファイルがあるものは変えない
      writeFileSync(join(ticketsDir, '20261020-0900-hhhh.md'), file('20261020-0900-hhhh', '重なる'))
      writeFileSync(
        join(ticketsDir, '20261020-0900-hhhh_重なる.md'),
        file('20261020-0900-zzzz', '別物')
      )
      const s = await startStore()

      expect(await s.renameUntitledFiles('山田')).toBe(3)
      expect(readdirSync(ticketsDir).sort()).toEqual([
        '20261020-0900-aaaa_見積書 A社B社.md',
        '20261020-0900-bbbb_手で付けた.md',
        '20261020-0900-cccc.md',
        '20261020-0900-dddd.md',
        '20261020-0900-eeee_自分の.md',
        '20261020-0900-hhhh.md',
        '20261020-0900-hhhh_重なる.md'
      ])
      expect(readdirSync(join(tasksDir, 'archive'))).toEqual(['20261020-0900-ffff.md'])
      expect(readdirSync(join(tasksDir, 'notes'))).toEqual(['20261020-0900-gggg_A社定例.md'])
      // 一覧も新しい名前に入れ替わり、警告（ID の重なりなど）は増えない
      const state = s.getState()
      expect(state.renamedOnStart).toBe(3)
      expect(state.tickets.map((t) => t.fileName)).toContain('20261020-0900-aaaa_見積書 A社B社.md')
      expect(state.tickets.map((t) => t.fileName)).not.toContain('20261020-0900-aaaa.md')
      expect(state.notes.map((n) => n.fileName)).toEqual(['notes/20261020-0900-gggg_A社定例.md'])
      expect(
        findWarnings(state.tickets, state.notes).filter((w) => w.kind === 'duplicate-id')
      ).toHaveLength(0)
      // 中身は1文字も変えない
      expect(readFileSync(join(ticketsDir, '20261020-0900-eeee_自分の.md'), 'utf8')).toBe(
        file('20261020-0900-eeee', '自分の', '山田')
      )
    })

    it('タイトル部分は40文字まで', async () => {
      mkdirSync(ticketsDir)
      const long = 'あ'.repeat(50)
      writeFileSync(join(ticketsDir, '20261020-0900-aaaa.md'), file('20261020-0900-aaaa', long))
      const s = await startStore()
      await s.renameUntitledFiles('')
      expect(readdirSync(ticketsDir)).toEqual([`20261020-0900-aaaa_${'あ'.repeat(40)}.md`])
    })
  })

  describe('タグの色（TAGS.md）', () => {
    it('読み込み、選んだ色を書き、外部の変更と競合コピーにも追従する', async () => {
      mkdirSync(ticketsDir)
      writeFileSync(join(tasksDir, 'TAGS.md'), '---\ncolors:\n  仕事: 210\n---\n\n# タグの色\n')
      const s = await startStore()
      expect(s.getState().tagColors).toEqual({ 仕事: 210 })

      await s.setTagColor('家', 30)
      expect(readFileSync(join(tasksDir, 'TAGS.md'), 'utf8')).toBe(
        '---\ncolors:\n  仕事: 210\n  家: 30\n---\n\n# タグの色\n'
      )
      expect(s.getState().tagColors).toEqual({ 仕事: 210, 家: 30 })

      writeFileSync(join(tasksDir, 'TAGS.md'), '---\ncolors:\n  仕事: 120\n---\n')
      await waitFor(() => latest?.tagColors['仕事'] === 120)

      writeFileSync(join(tasksDir, 'TAGS (1).md'), '---\ncolors:\n---\n')
      await waitFor(() => (latest?.tagFile.conflicts ?? []).includes('TAGS (1).md'))
    })

    it('続けて呼んでも、前の書き込みを消さない（1件ずつ順に書く）', async () => {
      mkdirSync(ticketsDir)
      const s = await startStore()
      await Promise.all([
        s.setTagColor('仕事', 10),
        s.setTagColor('家', 20),
        s.setTagColor('A社', 30)
      ])
      expect(s.getState().tagColors).toEqual({ 仕事: 10, 家: 20, A社: 30 })
    })

    it('colors の書き方が違う TAGS.md には書き込まない', async () => {
      mkdirSync(ticketsDir)
      const broken = '---\ncolors: [仕事]\n---\n'
      writeFileSync(join(tasksDir, 'TAGS.md'), broken)
      const s = await startStore()
      await expect(s.setTagColor('仕事', 10)).rejects.toThrow('colors')
      expect(readFileSync(join(tasksDir, 'TAGS.md'), 'utf8')).toBe(broken)
      // 失敗した後も、次の書き込みは待ち行列で止まらない
      writeFileSync(join(tasksDir, 'TAGS.md'), '---\ncolors:\n---\n')
      await s.setTagColor('仕事', 10)
      expect(s.getState().tagColors).toEqual({ 仕事: 10 })
    })

    it('TAGS.md がなければ作る。読めないときは理由を出す', async () => {
      mkdirSync(ticketsDir)
      const s = await startStore()
      expect(s.getState().tagColors).toEqual({})
      await s.setTagColor('仕事', 0)
      expect(readFileSync(join(tasksDir, 'TAGS.md'), 'utf8')).toContain('colors:\n  仕事: 0\n')

      writeFileSync(join(tasksDir, 'TAGS.md'), '# frontmatter なし\n')
      await waitFor(() => latest?.tagFile.error !== null && latest?.tagFile.error !== undefined)
      expect(latest?.tagColors).toEqual({})
    })
  })
})
