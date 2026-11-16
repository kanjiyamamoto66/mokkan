import { describe, expect, it, vi, type Mock } from 'vitest'
import { IPC } from '../shared/api'
import {
  decideOnboarding,
  isExternalUrl,
  normalizeCreateNoteRequest,
  normalizeFromNoteOptions,
  normalizeNoteFolder,
  normalizeTemplateName,
  normalizeTitle,
  normalizeUserName,
  onboardingHandlers,
  requireString,
  requireStringArray,
  settingsHandlers,
  ticketHandlers,
  type IpcHandler
} from './ipc'

describe('requireString', () => {
  it('文字列はそのまま返す（空文字も文字列として通す）', () => {
    expect(requireString('T-0001.md', 'fileName')).toBe('T-0001.md')
    expect(requireString('', 'baseText')).toBe('')
  })

  it.each([undefined, null, 1, true, {}, ['a'], new String('a')])(
    '文字列でない値（%o）はエラーにする',
    (value) => {
      expect(() => requireString(value, 'fileName')).toThrow('fileName が文字列ではありません')
    }
  )
})

describe('requireStringArray', () => {
  it('文字列の配列はそのまま返す', () => {
    expect(requireStringArray([], 'names')).toEqual([])
    expect(requireStringArray(['a', ''], 'names')).toEqual(['a', ''])
  })

  it.each([undefined, 'a', [1], ['a', null], {}])(
    '文字列の配列でない値（%o）はエラーにする',
    (value) => {
      expect(() => requireStringArray(value, 'names')).toThrow('names が文字列の配列ではありません')
    }
  )
})

describe('チケットのタイトル', () => {
  it('前後の空白を除く', () => {
    expect(normalizeTitle('  見積書を送る ')).toBe('見積書を送る')
  })

  it('空・改行・長すぎるタイトルは受け付けない', () => {
    expect(() => normalizeTitle('  ')).toThrow('タイトルを入れてください')
    expect(() => normalizeTitle('一行目\n二行目')).toThrow('制御文字')
    expect(() => normalizeTitle('あ'.repeat(201))).toThrow('200文字まで')
    expect(() => normalizeTitle(1)).toThrow('文字列ではありません')
  })
})

describe('isExternalUrl', () => {
  it.each(['https://example.com/', 'http://example.com/path?q=1', 'HTTPS://EXAMPLE.COM'])(
    '%s は開く',
    (url) => {
      expect(isExternalUrl(url)).toBe(true)
    }
  )

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'file://server/share/a.md',
    'javascript:alert(1)',
    'mailto:a@example.com',
    'ms-settings:',
    'smb://server/share',
    'C:\\Windows\\notepad.exe',
    '//example.com',
    ''
  ])('%s は開かない', (url) => {
    expect(isExternalUrl(url)).toBe(false)
  })
})

describe('ticketHandlers', () => {
  function setup(openPathResult = ''): {
    store: {
      [
        K in
          | 'readTicket'
          | 'saveTicket'
          | 'discardIfEmpty'
          | 'ticketPath'
          | 'archiveTicket'
          | 'restoreTicket'
          | 'archiveDoneBefore'
          | 'deleteTicket'
          | 'checkRuleFiles'
          | 'updateRuleFiles'
          | 'setTagColor'
          | 'search'
          | 'lint'
          | 'backlinks'
          | 'fixLink'
      ]: Mock
    }
    openPath: Mock
    handlers: Record<string, IpcHandler>
  } {
    const store = {
      readTicket: vi.fn(async () => 'text'),
      saveTicket: vi.fn(async () => ({ ok: true as const })),
      discardIfEmpty: vi.fn(async () => false),
      ticketPath: vi.fn((fileName: string) => `C:/tasks/tickets/${fileName}`),
      archiveTicket: vi.fn(async () => ({})),
      restoreTicket: vi.fn(async () => ({})),
      archiveDoneBefore: vi.fn(async () => ({})),
      deleteTicket: vi.fn(async () => 1),
      checkRuleFiles: vi.fn(async () => []),
      updateRuleFiles: vi.fn(async () => []),
      setTagColor: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
      listTemplates: vi.fn(async () => ({ tickets: [], notes: [] })),
      createNoteFolder: vi.fn(async () => 'x'),
      moveNote: vi.fn(async () => ({})),
      lint: vi.fn(async () => []),
      backlinks: vi.fn(async () => []),
      fixLink: vi.fn(async () => undefined)
    }
    const openPath = vi.fn(async () => openPathResult)
    // テスト用の偽物なので、戻り値の型は TaskStore と完全には一致しない
    const handlers = ticketHandlers(() => store as never, openPath)
    return { store, openPath, handlers }
  }

  it('チケットに関わるチャンネルをすべて持つ', () => {
    const { handlers } = setup()
    expect(Object.keys(handlers).sort()).toEqual(
      [
        IPC.readTicket,
        IPC.saveTicket,
        IPC.discardIfEmpty,
        IPC.archiveTicket,
        IPC.restoreTicket,
        IPC.archiveDoneBefore,
        IPC.deleteTicket,
        IPC.checkRuleFiles,
        IPC.updateRuleFiles,
        IPC.setTagColor,
        IPC.search,
        IPC.listTemplates,
        IPC.createNoteFolder,
        IPC.moveNote,
        IPC.lint,
        IPC.backlinks,
        IPC.fixLink,
        IPC.openExternal
      ].sort()
    )
  })

  it('点検は引数を受け取らず、被リンクと「直す」は文字列だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.lint]('2020-01-01')
    expect(store.lint).toHaveBeenCalledWith()
    await handlers[IPC.backlinks]('notes/a.md')
    expect(store.backlinks).toHaveBeenCalledWith('notes/a.md')
    expect(() => handlers[IPC.backlinks](1)).toThrow('文字列ではありません')
    await handlers[IPC.fixLink]('notes/a.md', '../tickets/b.md')
    expect(store.fixLink).toHaveBeenCalledWith('notes/a.md', '../tickets/b.md')
    expect(() => handlers[IPC.fixLink]('notes/a.md', '')).toThrow('リンク先が正しくありません')
    expect(() => handlers[IPC.fixLink]('notes/a.md', 'a'.repeat(2001))).toThrow(
      'リンク先が正しくありません'
    )
    expect(() => handlers[IPC.fixLink]('notes/a.md', null)).toThrow('文字列ではありません')
  })

  it('タグの色は、タグの名前と 0〜359 の整数（または null）だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.setTagColor](' 仕事 ', 210)
    expect(store.setTagColor).toHaveBeenCalledWith('仕事', 210)
    await handlers[IPC.setTagColor]('仕事', null)
    expect(store.setTagColor).toHaveBeenLastCalledWith('仕事', null)
    expect(() => handlers[IPC.setTagColor]('仕事', 360)).toThrow('色相')
    expect(() => handlers[IPC.setTagColor]('仕事', 1.5)).toThrow('色相')
    expect(() => handlers[IPC.setTagColor]('', 10)).toThrow('タグが空')
    expect(() => handlers[IPC.setTagColor]('a\nb', 10)).toThrow('制御文字')
  })

  it('検索は、文字列と「文字起こしも探す」の true だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.search]('見積', { includeTranscript: true })
    expect(store.search).toHaveBeenCalledWith('見積', { includeTranscript: true })
    await handlers[IPC.search]('見積', { includeTranscript: 'yes' })
    expect(store.search).toHaveBeenLastCalledWith('見積', { includeTranscript: false })
    expect(() => handlers[IPC.search](1, {})).toThrow()
    expect(() => handlers[IPC.search]('あ'.repeat(201), {})).toThrow('長すぎ')
  })

  it('ルールのファイルの更新は、文字列の配列だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.updateRuleFiles](['RULES.md', 'CLAUDE.md'])
    expect(store.updateRuleFiles).toHaveBeenCalledWith(['RULES.md', 'CLAUDE.md'])
    expect(() => handlers[IPC.updateRuleFiles]('RULES.md')).toThrow('文字列の配列ではありません')
    expect(() => handlers[IPC.updateRuleFiles]([1])).toThrow('文字列の配列ではありません')
  })

  it('アーカイブ・削除は文字列のキーだけ、まとめてアーカイブは正しい日付だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.archiveTicket]('a.md')
    await handlers[IPC.deleteTicket]('archive/a.md')
    expect(store.archiveTicket).toHaveBeenCalledWith('a.md')
    expect(store.deleteTicket).toHaveBeenCalledWith('archive/a.md')
    expect(() => handlers[IPC.deleteTicket](['a.md'])).toThrow('文字列ではありません')

    await handlers[IPC.archiveDoneBefore]('2026-09-18')
    expect(store.archiveDoneBefore).toHaveBeenCalledWith('2026-09-18')
    expect(() => handlers[IPC.archiveDoneBefore]('2026-02-30')).toThrow('日付が正しくありません')
    expect(() => handlers[IPC.archiveDoneBefore](30)).toThrow('文字列ではありません')
  })

  it('readTicket は文字列のファイル名だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await expect(handlers[IPC.readTicket]('T-0001.md')).resolves.toBe('text')
    expect(store.readTicket).toHaveBeenCalledWith('T-0001.md')

    expect(() => handlers[IPC.readTicket](42)).toThrow('fileName が文字列ではありません')
    expect(store.readTicket).toHaveBeenCalledTimes(1)
  })

  it('saveTicket は force が true のときだけ上書きを頼む', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.saveTicket]('T-0001.md', 'base', 'new', true)
    expect(store.saveTicket).toHaveBeenLastCalledWith('T-0001.md', 'base', 'new', true)
  })

  it.each([false, undefined, null, 'true', 1, {}, [true]])(
    'saveTicket の force が %o なら false として扱う',
    async (force) => {
      const { store, handlers } = setup()
      await handlers[IPC.saveTicket]('T-0001.md', 'base', 'new', force)
      expect(store.saveTicket).toHaveBeenLastCalledWith('T-0001.md', 'base', 'new', false)
    }
  )

  it.each([
    ['fileName', [1, 'base', 'new', false]],
    ['baseText', ['T-0001.md', null, 'new', false]],
    ['newText', ['T-0001.md', 'base', undefined, false]]
  ])('saveTicket の %s が文字列でなければ保存しない', (name, args) => {
    const { store, handlers } = setup()
    expect(() => handlers[IPC.saveTicket](...args)).toThrow(`${name} が文字列ではありません`)
    expect(store.saveTicket).not.toHaveBeenCalled()
  })

  it('discardIfEmpty は文字列のファイル名だけを受け付ける', async () => {
    const { store, handlers } = setup()
    await handlers[IPC.discardIfEmpty]('T-0001.md')
    expect(store.discardIfEmpty).toHaveBeenCalledWith('T-0001.md')

    expect(() => handlers[IPC.discardIfEmpty]({})).toThrow('fileName が文字列ではありません')
    expect(store.discardIfEmpty).toHaveBeenCalledTimes(1)
  })

  it('openExternal はチケットのパスを開き、失敗したらエラーにする', async () => {
    const ok = setup()
    await ok.handlers[IPC.openExternal]('T-0001.md')
    expect(ok.openPath).toHaveBeenCalledWith('C:/tasks/tickets/T-0001.md')

    const ng = setup('開けませんでした')
    await expect(ng.handlers[IPC.openExternal]('T-0001.md')).rejects.toThrow('開けませんでした')

    const bad = setup()
    await expect(bad.handlers[IPC.openExternal](null)).rejects.toThrow(
      'fileName が文字列ではありません'
    )
    expect(bad.openPath).not.toHaveBeenCalled()
  })
})

/** テンプレートの選択を使わないテストで渡す、何もしない設定 */
const noTemplateChoice = {
  getTemplateChoice: () => null,
  saveTemplateChoice: vi.fn(),
  getAiService: () => 'claude' as const,
  saveAiService: vi.fn()
}

describe('settingsHandlers', () => {
  it('正しい並び順だけを保存する', () => {
    const saveListSort = vi.fn()
    const handlers = settingsHandlers({
      getListSort: () => null,
      saveListSort,
      getUserName: () => '',
      saveUserName: vi.fn(),
      ...noTemplateChoice
    })
    handlers[IPC.setListSort]({ key: 'created', direction: 'desc' })
    expect(saveListSort).toHaveBeenCalledWith({ key: 'created', direction: 'desc' })

    expect(() => handlers[IPC.setListSort]({ key: 'created', direction: 'down' })).toThrow(
      '並び順の値が正しくありません'
    )
    expect(() => handlers[IPC.setListSort]('due')).toThrow('並び順の値が正しくありません')
    expect(saveListSort).toHaveBeenCalledTimes(1)
  })

  it('保存した並び順を返す', () => {
    const handlers = settingsHandlers({
      getListSort: () => ({ key: 'title', direction: 'asc' }),
      saveListSort: vi.fn(),
      getUserName: () => '',
      saveUserName: vi.fn(),
      ...noTemplateChoice
    })
    expect(handlers[IPC.getListSort]()).toEqual({ key: 'title', direction: 'asc' })
  })
})

describe('テンプレートとフォルダの指定', () => {
  it('テンプレートの名前は、空なら既定（null）。区切り文字や改行を含む名前は受け付けない', () => {
    expect(normalizeTemplateName(undefined)).toBeNull()
    expect(normalizeTemplateName('')).toBeNull()
    expect(normalizeTemplateName('議事メモ')).toBe('議事メモ')
    expect(() => normalizeTemplateName('../RULES')).toThrow('正しくありません')
    expect(() => normalizeTemplateName('a\\b')).toThrow('正しくありません')
    expect(() => normalizeTemplateName('a\nb')).toThrow('正しくありません')
    expect(() => normalizeTemplateName(1)).toThrow()
  })

  it('フォルダは notes/ の外や隠しフォルダを指さない形だけを受け付ける', () => {
    expect(normalizeNoteFolder(undefined)).toBe('')
    expect(normalizeNoteFolder('案件A/定例')).toBe('案件A/定例')
    expect(() => normalizeNoteFolder('../tickets')).toThrow('正しくありません')
    expect(() => normalizeNoteFolder('案件A/../..')).toThrow('正しくありません')
    expect(() => normalizeNoteFolder('/案件A')).toThrow('正しくありません')
    expect(() => normalizeNoteFolder('.git')).toThrow('正しくありません')
    expect(() => normalizeNoteFolder('C:\\x')).toThrow('正しくありません')
  })

  it('新しいノートの指定をまとめて確かめる', () => {
    expect(normalizeCreateNoteRequest(undefined)).toEqual({ template: null, folder: '' })
    expect(normalizeCreateNoteRequest({ template: '手順', folder: '共通' })).toEqual({
      template: '手順',
      folder: '共通'
    })
    expect(() => normalizeCreateNoteRequest('手順')).toThrow()
  })

  it('前回選んだテンプレートを種類ごとに保存する', () => {
    const saveTemplateChoice = vi.fn()
    const handlers = settingsHandlers({
      getListSort: () => null,
      saveListSort: vi.fn(),
      getUserName: () => '',
      saveUserName: vi.fn(),
      getTemplateChoice: (kind) => (kind === 'note' ? '議事メモ' : null),
      saveTemplateChoice,
      getAiService: () => 'claude',
      saveAiService: vi.fn()
    })
    expect(handlers[IPC.getTemplateChoice]('note')).toBe('議事メモ')
    expect(handlers[IPC.getTemplateChoice]('ticket')).toBeNull()
    handlers[IPC.setTemplateChoice]('note', '手順')
    handlers[IPC.setTemplateChoice]('ticket', null)
    expect(saveTemplateChoice.mock.calls).toEqual([
      ['note', '手順'],
      ['ticket', null]
    ])
    expect(() => handlers[IPC.getTemplateChoice]('rules')).toThrow('種類')
    expect(() => handlers[IPC.setTemplateChoice]('note', '../x')).toThrow()
  })
})

describe('使う AI', () => {
  it('知っている AI の名前だけを保存する', () => {
    const saveAiService = vi.fn()
    const handlers = settingsHandlers({
      getListSort: () => null,
      saveListSort: vi.fn(),
      getUserName: () => '',
      saveUserName: vi.fn(),
      ...noTemplateChoice,
      getAiService: () => 'cursor',
      saveAiService
    })
    expect(handlers[IPC.getAiService]()).toBe('cursor')
    handlers[IPC.setAiService]('cursor')
    expect(saveAiService).toHaveBeenCalledWith('cursor')
    expect(() => handlers[IPC.setAiService]('codex')).toThrow('AI の名前が正しくありません')
    expect(() => handlers[IPC.setAiService]('C:\\agent.exe')).toThrow('AI の名前が正しくありません')
    expect(saveAiService).toHaveBeenCalledTimes(1)
  })
})

describe('自分の名前', () => {
  it('前後の空白を除いて保存し、保存した名前を返す', () => {
    const saveUserName = vi.fn()
    const handlers = settingsHandlers({
      getListSort: () => null,
      saveListSort: vi.fn(),
      getUserName: () => '山田',
      saveUserName,
      ...noTemplateChoice
    })
    expect(handlers[IPC.setUserName]('  山田 太郎 ')).toBe('山田 太郎')
    expect(saveUserName).toHaveBeenCalledWith('山田 太郎')
    expect(handlers[IPC.getUserName]()).toBe('山田')
  })

  it('文字列でない・改行を含む・長すぎる名前は受け付けない', () => {
    expect(normalizeUserName('')).toBe('')
    expect(() => normalizeUserName(1)).toThrow('文字列ではありません')
    expect(() => normalizeUserName('山田\nstatus: done')).toThrow('制御文字')
    expect(() => normalizeUserName('あ'.repeat(101))).toThrow('100文字まで')
  })
})

describe('decideOnboarding（設定ボタンへの案内）', () => {
  const same = async (): Promise<{ name: string; state: 'same' }[]> => [
    { name: 'RULES.md', state: 'same' }
  ]
  const changed = async (): Promise<{ name: string; state: 'same' | 'different' }[]> => [
    { name: 'RULES.md', state: 'different' },
    { name: 'CLAUDE.md', state: 'same' }
  ]

  it('初めての起動（覚えた版も名前もない）なら必ず出す', async () => {
    expect(await decideOnboarding(null, '0.2.0', '', same)).toBe('first')
  })

  it('同じ版なら何も出さない', async () => {
    expect(await decideOnboarding('0.2.0', '0.2.0', '', changed)).toBeNull()
  })

  it('バージョンアップでは、ルールのファイルが原本と違うときだけ出す', async () => {
    expect(await decideOnboarding('0.1.0', '0.2.0', '高橋', changed)).toBe('rules-updated')
    expect(await decideOnboarding('0.1.0', '0.2.0', '高橋', same)).toBeNull()
  })

  it('版を覚えていない古い設定でも、名前があればバージョンアップとして扱う', async () => {
    expect(await decideOnboarding(null, '0.2.0', '高橋', changed)).toBe('rules-updated')
    expect(await decideOnboarding(null, '0.2.0', '高橋', same)).toBeNull()
  })
})

describe('normalizeFromNoteOptions', () => {
  it('宿題の項目・担当者・期限を確かめて整える', () => {
    expect(normalizeFromNoteOptions(undefined)).toEqual({
      homeworkItem: null,
      assignee: [],
      due: null
    })
    expect(
      normalizeFromNoteOptions({
        homeworkItem: ' 見積書を送る ',
        assignee: [' 高橋 ', ''],
        due: '2026-10-30'
      })
    ).toEqual({ homeworkItem: '見積書を送る', assignee: ['高橋'], due: '2026-10-30' })
  })

  it('正しくない値は受け付けない', () => {
    expect(() => normalizeFromNoteOptions({ homeworkItem: 'a\nb' })).toThrow('1行')
    expect(() => normalizeFromNoteOptions({ due: '10/30' })).toThrow('期限')
    expect(() => normalizeFromNoteOptions({ assignee: '高橋' })).toThrow()
    expect(() => normalizeFromNoteOptions([1])).toThrow()
  })
})

describe('onboardingHandlers', () => {
  function setup(
    last: string | null,
    states: { name: string; state: 'same' | 'different' }[]
  ): { handlers: Record<string, IpcHandler>; saveLastVersion: Mock } {
    const saveLastVersion = vi.fn()
    const handlers = onboardingHandlers({
      version: '0.2.0',
      getLastVersion: () => last,
      saveLastVersion,
      getUserName: () => '高橋',
      checkRuleFiles: async () => states
    })
    return { handlers, saveLastVersion }
  }

  it('案内が要らなければ今の版を覚え、案内を出すときは閉じるまで覚えない', async () => {
    const none = setup('0.1.0', [{ name: 'RULES.md', state: 'same' }])
    expect(await none.handlers[IPC.getOnboarding]()).toBeNull()
    expect(none.saveLastVersion).toHaveBeenCalledWith('0.2.0')

    const updated = setup('0.1.0', [{ name: 'RULES.md', state: 'different' }])
    expect(await updated.handlers[IPC.getOnboarding]()).toBe('rules-updated')
    expect(updated.saveLastVersion).not.toHaveBeenCalled()
    await updated.handlers[IPC.dismissOnboarding]()
    expect(updated.saveLastVersion).toHaveBeenCalledWith('0.2.0')
  })
})
