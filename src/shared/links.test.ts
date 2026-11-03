import { describe, expect, it } from 'vitest'
import {
  idFromHref,
  linkCandidates,
  markdownLinkDestination,
  normalizeForSearch,
  relativeLinkPath
} from './links'

describe('relativeLinkPath', () => {
  it('同じフォルダならファイル名だけ、違えば ../フォルダ/ファイル名', () => {
    expect(relativeLinkPath('a.md', 'b_見積.md')).toBe('b_見積.md')
    expect(relativeLinkPath('notes/n.md', 'b_見積.md')).toBe('../tickets/b_見積.md')
    expect(relativeLinkPath('a.md', 'notes/n_定例.md')).toBe('../notes/n_定例.md')
    expect(relativeLinkPath('archive/x.md', 'archive/y.md')).toBe('y.md')
    expect(relativeLinkPath('notes/n.md', 'archive/y.md')).toBe('../archive/y.md')
  })
})

describe('idFromHref', () => {
  it('リンク先のファイル名の先頭の ID を読む（フォルダやタイトル部分は問わない）', () => {
    expect(idFromHref('../tickets/20261015-1510-mt02_A社に見積書を送る.md')).toBe(
      '20261015-1510-mt02'
    )
    expect(idFromHref('20261015-1510-mt02.md')).toBe('20261015-1510-mt02')
    expect(idFromHref('../archive/20261015-1510-mt02_%E8%A6%8B%E7%A9%8D.md')).toBe(
      '20261015-1510-mt02'
    )
  })

  it('URL や ID で始まらないファイルは対象外', () => {
    expect(idFromHref('https://example.com/20261015-1510-mt02.md')).toBeNull()
    expect(idFromHref('../RULES.md')).toBeNull()
    expect(idFromHref('memo.md')).toBeNull()
  })
})

describe('linkCandidates', () => {
  const targets = [
    { fileName: 'a.md', id: '20261001-0900-aaaa', title: 'A社に見積書を送る', modified: 1 },
    { fileName: 'notes/b.md', id: '20261002-0900-bbbb', title: 'A社定例', modified: 3 },
    { fileName: 'archive/c.md', id: '20261003-0900-cccc', title: 'ケンタくんの件', modified: 2 },
    { fileName: 'd.md', id: null, title: 'id なし', modified: 9 }
  ]

  it('タイトルか ID の部分一致で、最近更新したものを上に出す。自分と id のないものは出さない', () => {
    expect(linkCandidates('a社', targets, 'x.md').map((t) => t.fileName)).toEqual([
      'notes/b.md',
      'a.md'
    ])
    expect(linkCandidates('', targets, 'notes/b.md').map((t) => t.fileName)).toEqual([
      'archive/c.md',
      'a.md'
    ])
    expect(linkCandidates('0900-cc', targets, 'x.md').map((t) => t.fileName)).toEqual([
      'archive/c.md'
    ])
  })

  it('カタカナとひらがな、全角と半角を区別しない', () => {
    expect(linkCandidates('けんた', targets, 'x.md').map((t) => t.fileName)).toEqual([
      'archive/c.md'
    ])
    expect(normalizeForSearch('ＡＢＣ　カナ')).toBe('abc かな')
  })
})

describe('markdownLinkDestination', () => {
  it('空白や括弧があるときだけ <…> で囲む', () => {
    expect(markdownLinkDestination('../tickets/a_見積.md')).toBe('../tickets/a_見積.md')
    expect(markdownLinkDestination('../tickets/a_定例 10月.md')).toBe('<../tickets/a_定例 10月.md>')
    expect(markdownLinkDestination('a_見積(案).md')).toBe('<a_見積(案).md>')
  })
})
