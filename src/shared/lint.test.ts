import { describe, expect, it } from 'vitest'
import {
  backlinksOf,
  bodyRefs,
  lintFiles,
  lintToMarkdown,
  replaceLinkDestination,
  type LintEntry
} from './lint'
import { parseNote } from './note'
import { parseTicket } from './ticket'

const TODAY = '2026-11-10'

function ticket(
  fileName: string,
  body = '',
  id = fileName.replace(/^archive\//, '').slice(0, 18)
): LintEntry {
  const text = `---\nid: ${id}\nstatus: todo\ncreated: 2026-11-01\n---\n\n# ${fileName}\n${body}`
  return { file: parseTicket(fileName, text), text }
}

function note(
  key: string,
  {
    type = 'record',
    reviewed = '',
    body = ''
  }: { type?: string; reviewed?: string; body?: string } = {}
): LintEntry {
  const id = key.slice(key.lastIndexOf('/') + 1, key.lastIndexOf('/') + 19)
  const text = `---\nid: ${id}\ntype: ${type}\ndate:\nreviewed: ${reviewed}\ntags: []\nauthor:\ncreated: 2026-11-01\n---\n\n# ${key}\n${body}`
  return { file: parseNote(key, text), text }
}

const kinds = (items: { kind: string; fileName: string | null }[]): string[] =>
  items.map((i) => `${i.kind}:${i.fileName ?? ''}`)

describe('bodyRefs', () => {
  it('md のリンクと文字の ID を、ファイルの行で返す（frontmatter の行も数える）', () => {
    const text = [
      '---',
      'id: 20261101-0900-aaaa',
      '---',
      '',
      '# タイトル',
      '- [見積](../tickets/20261101-0900-bbbb_見積.md) の続き',
      '- 20261101-0900-cccc を見る',
      '',
      '`20261101-0900-dddd` はコード',
      '',
      '```',
      '20261101-0900-eeee',
      '```',
      '',
      '[参照]: ../notes/20261101-0900-ffff.md'
    ].join('\n')
    expect(bodyRefs(text)).toEqual([
      { id: '20261101-0900-bbbb', href: '../tickets/20261101-0900-bbbb_見積.md', line: 6 },
      { id: '20261101-0900-cccc', href: null, line: 7 },
      { id: '20261101-0900-ffff', href: '../notes/20261101-0900-ffff.md', line: 15 }
    ])
  })

  it('リンクの文字の ID は、リンク先と別に数えない', () => {
    expect(bodyRefs('→ [20261101-0900-bbbb](../tickets/20261101-0900-bbbb.md)')).toEqual([
      { id: '20261101-0900-bbbb', href: '../tickets/20261101-0900-bbbb.md', line: 1 }
    ])
  })
})

describe('lintFiles：リンク', () => {
  it('切れたリンクと、見つからない ID', () => {
    const items = lintFiles(
      [
        note('notes/20261101-0900-n001_メモ.md', {
          body: '[消えた](../tickets/20261101-0900-gone.md)\n20261101-0900-nope も'
        })
      ],
      TODAY
    )
    expect(items.map((i) => [i.kind, i.detail, i.line])).toEqual([
      [
        'broken-link',
        'リンク先 ../tickets/20261101-0900-gone.md の 20261101-0900-gone が見つかりません',
        12
      ],
      ['broken-link', '20261101-0900-nope が見つかりません', 13]
    ])
  })

  it('移したノート・名前を変えたチケット・アーカイブしたチケットへのリンクは、ずれたリンク', () => {
    const items = lintFiles(
      [
        note('notes/A社/20261101-0900-n001_定例.md', {
          body: [
            '[手順](20261101-0900-n002_手順.md)',
            '[見積](../../tickets/20261101-0900-t001.md)',
            '[完了](../../tickets/20261101-0900-t002_完了.md)',
            '[正しい](../../tickets/20261101-0900-t003_正しい.md)'
          ].join('\n')
        }),
        note('notes/共通/20261101-0900-n002_手順.md'),
        ticket('20261101-0900-t001_見積.md'),
        ticket('archive/20261101-0900-t002_完了.md'),
        ticket('20261101-0900-t003_正しい.md')
      ],
      TODAY
    ).filter((i) => i.kind === 'shifted-link')
    expect(items.map((i) => [i.detail, i.href])).toEqual([
      [
        '20261101-0900-n002_手順.md → ../共通/20261101-0900-n002_手順.md',
        '20261101-0900-n002_手順.md'
      ],
      [
        '../../tickets/20261101-0900-t001.md → ../../tickets/20261101-0900-t001_見積.md',
        '../../tickets/20261101-0900-t001.md'
      ],
      [
        '../../tickets/20261101-0900-t002_完了.md → ../../archive/20261101-0900-t002_完了.md',
        '../../tickets/20261101-0900-t002_完了.md'
      ]
    ])
  })

  it('%・<…>・# を含むリンク先も、指すファイルが同じならずれていない', () => {
    const items = lintFiles(
      [
        ticket(
          '20261101-0900-t001.md',
          '[a](<20261101-0900-t002_見積 (改).md>) [b](20261101-0900-t002_%E8%A6%8B%E7%A9%8D%20(%E6%94%B9).md#x)'
        ),
        ticket('20261101-0900-t002_見積 (改).md')
      ],
      TODAY
    )
    expect(items).toEqual([])
  })

  it('アーカイブのファイルのリンクは見ない', () => {
    expect(
      lintFiles([ticket('archive/20261101-0900-t001.md', '20261101-0900-gone')], TODAY)
    ).toEqual([])
  })
})

describe('lintFiles：知識と入口', () => {
  it('入口がないプロジェクト（共通/ と直下は除く）', () => {
    const items = lintFiles(
      [
        note('notes/A社/20261101-0900-n001.md'),
        note('notes/B社/20261101-0900-n002.md', { type: 'index' }),
        note('notes/共通/20261101-0900-n003.md'),
        note('notes/20261101-0900-n004.md')
      ],
      TODAY
    )
    expect(items.map((i) => [i.kind, i.title])).toEqual([['no-index', 'A社']])
  })

  it('入口から外れた知識：プロジェクトは入口から、共通/ はどこかからリンクされているか', () => {
    const items = lintFiles(
      [
        note('notes/A社/20261101-0900-ix01.md', {
          type: 'index',
          body: '- [載っている](20261101-0900-kn01.md)'
        }),
        note('notes/A社/20261101-0900-kn01.md', { type: 'knowledge', reviewed: TODAY }),
        note('notes/A社/定例/20261101-0900-kn02.md', { type: 'knowledge', reviewed: TODAY }),
        note('notes/A社/20261101-0900-mt01.md', { body: '20261101-0900-kn02 を見る' }),
        note('notes/共通/20261101-0900-kn03.md', { type: 'knowledge', reviewed: TODAY }),
        note('notes/共通/20261101-0900-kn04.md', { type: 'knowledge', reviewed: TODAY }),
        ticket('20261101-0900-t001.md', '20261101-0900-kn03'),
        note('notes/B社/20261101-0900-kn05.md', { type: 'knowledge', reviewed: TODAY })
      ],
      TODAY
    )
    expect(kinds(items)).toEqual([
      'no-index:',
      'orphan:notes/A社/定例/20261101-0900-kn02.md',
      'orphan:notes/共通/20261101-0900-kn04.md'
    ])
  })

  it('見直していない知識（日がない・180日より前）。記録のノートは見ない', () => {
    const items = lintFiles(
      [
        note('notes/共通/20261101-0900-kn01.md', { type: 'knowledge' }),
        note('notes/共通/20261101-0900-kn02.md', { type: 'knowledge', reviewed: '2026-05-13' }),
        note('notes/共通/20261101-0900-kn03.md', { type: 'knowledge', reviewed: '2026-05-14' }),
        note('notes/共通/20261101-0900-mt01.md', {
          body: '20261101-0900-kn01 20261101-0900-kn02 20261101-0900-kn03'
        })
      ],
      TODAY
    )
    expect(items.map((i) => [i.kind, i.detail])).toEqual([
      ['unreviewed', '見直した日がありません'],
      ['unreviewed', '最後に見直した日 2026-05-13（181日前）']
    ])
  })

  it('確かめていない記述と、長すぎる知識', () => {
    const items = lintFiles(
      [
        note('notes/共通/20261101-0900-kn01.md', {
          type: 'knowledge',
          reviewed: TODAY,
          body: ['- 値は 10（要確認：版が変わった）', '- 色は青（未確認）'].join('\n')
        }),
        note('notes/共通/20261101-0900-kn02.md', {
          type: 'knowledge',
          reviewed: TODAY,
          // 見出しの行（30文字ほど）と合わせて 3000 文字以下
          body: 'あ'.repeat(2960) + ' \n \n'
        }),
        note('notes/共通/20261101-0900-kn03.md', {
          type: 'knowledge',
          reviewed: TODAY,
          body: 'あ'.repeat(3001)
        }),
        note('notes/共通/20261101-0900-mt01.md', {
          body: '20261101-0900-kn01 20261101-0900-kn02 20261101-0900-kn03（要確認）'
        })
      ],
      TODAY
    )
    expect(items.map((i) => [i.kind, i.fileName, i.detail, i.line])).toEqual([
      [
        'unverified',
        'notes/共通/20261101-0900-kn01.md',
        '2 か所（最初：- 値は 10（要確認：版が変わった））',
        12
      ],
      // 見出しの行 `#notes/共通/20261101-0900-kn03.md`（31文字）も数える
      ['too-long', 'notes/共通/20261101-0900-kn03.md', '本文 3032 文字', null]
    ])
  })
})

describe('backlinksOf', () => {
  it('本文のリンクと ID で指しているファイル。自分と parent・source は含めない', () => {
    const target = note('notes/20261101-0900-n001_手順.md', {
      body: '自分 20261101-0900-n001'
    })
    const parentOnly = {
      ...ticket('20261101-0900-t002.md'),
      text: '---\nid: 20261101-0900-t002\nsource: 20261101-0900-n001\n---\n\n# 元\n'
    }
    expect(
      backlinksOf('notes/20261101-0900-n001_手順.md', [
        target,
        ticket('20261101-0900-t001.md', '[手順](../notes/20261101-0900-n001_手順.md)'),
        ticket('archive/20261101-0900-t003.md', '20261101-0900-n001 で'),
        parentOnly
      ])
    ).toEqual([
      { fileName: '20261101-0900-t001.md', title: '20261101-0900-t001.md' },
      { fileName: 'archive/20261101-0900-t003.md', title: 'archive/20261101-0900-t003.md' }
    ])
  })
})

describe('replaceLinkDestination', () => {
  const head = '---\nid: x\nnote: "[a](old.md)"\n---\n\n'

  it('そのリンク先だけを書き換え、ほかは1文字も変えない（frontmatter も）', () => {
    const text = `${head}- [a](old.md "題") と [b](other.md)\r\n- [a2](old.md#x)\n- \`[c](old.md)\`\n`
    expect(replaceLinkDestination(text, 'old.md', '../共通/new.md')).toBe(
      `${head}- [a](../共通/new.md "題") と [b](other.md)\r\n- [a2](old.md#x)\n- \`[c](old.md)\`\n`
    )
    expect(replaceLinkDestination(text, 'old.md#x', '../共通/new.md')).toBe(
      `${head}- [a](old.md "題") と [b](other.md)\r\n- [a2](../共通/new.md#x)\n- \`[c](old.md)\`\n`
    )
  })

  it('同じリンク先が2つあれば両方。空白や括弧は <…> で囲む。<…> のリンク先も書き換える', () => {
    const text = `${head}[x](<a b.md>) [y](<a b.md>) [z\\]](a.md)\n`
    expect(replaceLinkDestination(text, 'a b.md', 'c (d).md')).toBe(
      `${head}[x](<c (d).md>) [y](<c (d).md>) [z\\]](a.md)\n`
    )
    expect(replaceLinkDestination(text, 'a.md', 'b.md')).toBe(
      `${head}[x](<a b.md>) [y](<a b.md>) [z\\]](b.md)\n`
    )
  })

  it('参照の形のリンクや、ないリンク先は書き換えない', () => {
    const text = `${head}[a][r]\n\n[r]: old.md\n`
    expect(replaceLinkDestination(text, 'old.md', 'new.md')).toBeNull()
    expect(replaceLinkDestination(text, 'none.md', 'new.md')).toBeNull()
  })
})

describe('lintToMarkdown', () => {
  it('種類ごとの見出しと、tasks/ からのリンク', () => {
    const md = lintToMarkdown(
      [
        {
          kind: 'broken-link',
          fileName: 'notes/A社/20261101-0900-n001_定 例.md',
          title: '定例[1]',
          detail: '20261101-0900-gone が見つかりません',
          line: 12,
          href: null
        },
        { kind: 'no-index', fileName: null, title: 'B社', detail: 'なし', line: null, href: null },
        {
          kind: 'shifted-link',
          fileName: 'archive/20261101-0900-t001.md',
          title: '見積',
          detail: 'a → b',
          line: null,
          href: 'a'
        }
      ],
      TODAY
    )
    expect(md).toContain('# ノートの点検（2026-11-10）')
    expect(md).toContain(
      '## 切れたリンク\n\nリンク先の ID のチケット・ノートがありません\n\n- [定例\\[1\\]](<notes/A社/20261101-0900-n001_定 例.md>)（12行目）：20261101-0900-gone が見つかりません\n'
    )
    expect(md).toContain('- [見積](archive/20261101-0900-t001.md)：a → b')
    expect(md).toContain('- `notes/B社/`：なし')
    expect(md.indexOf('ずれたリンク')).toBeLessThan(md.indexOf('入口がない'))
  })

  it('何もなければそう書く', () => {
    expect(lintToMarkdown([], TODAY)).toBe(
      '# ノートの点検（2026-11-10）\n\n見つかったものはありません。\n'
    )
  })
})
