import { describe, expect, it } from 'vitest'
import { compareHits, removeTranscript, searchFile, splitTerms, type SearchHit } from './search'

const ticket =
  '---\nid: a\n---\n\n# A社に見積書を送る\n\n## メモ\n- 金額は前回と同じでいいか確認する\n'
const note =
  '---\nid: n\n---\n\n# A社定例\n\n## 宿題\n- 資料を置く\n\n## 文字起こし\n高橋: 見積書は来週送ります\n\n## おまけ\nケーキ\n'

const entry = (
  fileName: string,
  title: string,
  modified = 0
): {
  fileName: string
  title: string
  modified: number
} => ({ fileName, title, modified })

describe('splitTerms', () => {
  it('空白（全角も）で区切り、探す形に揃える', () => {
    expect(splitTerms(' Ａ社　見積 ')).toEqual(['a社', '見積'])
    expect(splitTerms('')).toEqual([])
  })
})

describe('searchFile', () => {
  const off = { includeTranscript: false }

  it('すべての語がタイトルか本文にあれば当たり。当たった行の文を出す', () => {
    const hit = searchFile(entry('a.md', 'A社に見積書を送る'), ticket, splitTerms('前回 見積'), off)
    expect(hit).toMatchObject({ kind: 'ticket', matchedInTitle: true, term: '前回' })
    expect(hit?.snippet).toBe('- 金額は前回と同じでいいか確認する')
    expect(
      searchFile(entry('a.md', 'A社に見積書を送る'), ticket, splitTerms('前回 請求'), off)
    ).toBeNull()
  })

  it('かな・全角半角・大文字小文字を区別しない', () => {
    expect(
      searchFile(entry('a.md', 'A社に見積書を送る'), ticket, splitTerms('ｋａｋｕｎｉｎ'), off)
    ).toBeNull()
    expect(
      searchFile(entry('a.md', 'A社に見積書を送る'), ticket, splitTerms('ア社'), off)
    ).toBeNull()
    expect(
      searchFile(entry('a.md', 'A社に見積書を送る'), ticket, splitTerms('a社'), off)
    ).not.toBeNull()
    expect(
      searchFile(
        entry('a.md', 'カタカナ'),
        '---\nid: a\n---\n\nかたかな\n',
        splitTerms('かたかな'),
        off
      )
    ).toMatchObject({ matchedInTitle: true })
  })

  it('ノートの文字起こしは、切り替えたときだけ探す', () => {
    const e = entry('notes/n.md', 'A社定例')
    expect(searchFile(e, note, splitTerms('来週'), off)).toBeNull()
    expect(searchFile(e, note, splitTerms('来週'), { includeTranscript: true })?.snippet).toBe(
      '高橋: 見積書は来週送ります'
    )
    // 文字起こしの後ろの節は探す
    expect(searchFile(e, note, splitTerms('ケーキ'), off)).toMatchObject({ kind: 'note' })
  })

  it('長い行は当たった箇所のまわりだけを出す', () => {
    const long = `---\nid: a\n---\n\n${'あ'.repeat(100)}見積${'い'.repeat(100)}\n`
    const snippet = searchFile(entry('archive/a.md', 'x'), long, ['見積'], off)!.snippet
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('見積')
  })

  it('アーカイブの種類', () => {
    expect(searchFile(entry('archive/a.md', 'A社'), ticket, ['a社'], off)?.kind).toBe('archive')
  })
})

describe('removeTranscript と並び順', () => {
  it('文字起こしの節だけを除く', () => {
    expect(removeTranscript('## 宿題\n- a\n## 文字起こし\nb\n### 小見出し\nc\n## 次\nd\n')).toBe(
      '## 宿題\n- a\n## 次\nd\n'
    )
  })

  it('タイトルに当たったものを上に、同じなら新しいものを上にする', () => {
    const hit = (fileName: string, matchedInTitle: boolean, modified: number): SearchHit => ({
      fileName,
      title: '',
      kind: 'ticket' as const,
      snippet: '',
      matchedInTitle,
      term: '',
      modified
    })
    expect(
      [hit('a', false, 3), hit('b', true, 1), hit('c', false, 5)]
        .sort(compareHits)
        .map((h) => h.fileName)
    ).toEqual(['b', 'c', 'a'])
  })
})
