import { describe, expect, it } from 'vitest'
import {
  idFromHref,
  linkCandidates,
  markdownLinkDestination,
  normalizeForSearch,
  relativeLinkPath,
  resolveLinkPath,
  tasksPathOf
} from './links'

describe('tasksPathOf と resolveLinkPath', () => {
  it('キーを tasks/ からのパスにする', () => {
    expect(tasksPathOf('20261101-0900-t001.md')).toBe('tickets/20261101-0900-t001.md')
    expect(tasksPathOf('archive/20261101-0900-t001.md')).toBe('archive/20261101-0900-t001.md')
    expect(tasksPathOf('notes/A社/x.md')).toBe('notes/A社/x.md')
  })

  it('リンク先を、書いたファイルのフォルダから読む', () => {
    expect(resolveLinkPath('notes/A社/x.md', '../../tickets/y.md')).toBe('tickets/y.md')
    expect(resolveLinkPath('notes/A社/x.md', './y.md#見出し')).toBe('notes/A社/y.md')
    expect(resolveLinkPath('t.md', '../notes/%E5%85%B1%E9%80%9A/y.md?a')).toBe('notes/共通/y.md')
    expect(resolveLinkPath('t.md', '../../y.md')).toBeNull()
    expect(resolveLinkPath('t.md', '/y.md')).toBeNull()
    expect(resolveLinkPath('t.md', 'https://example.com/y.md')).toBeNull()
  })
})

describe('relativeLinkPath', () => {
  it('同じフォルダならファイル名だけ、違えば ../フォルダ/ファイル名', () => {
    expect(relativeLinkPath('a.md', 'b_見積.md')).toBe('b_見積.md')
    expect(relativeLinkPath('notes/n.md', 'b_見積.md')).toBe('../tickets/b_見積.md')
    expect(relativeLinkPath('a.md', 'notes/n_定例.md')).toBe('../notes/n_定例.md')
    expect(relativeLinkPath('archive/x.md', 'archive/y.md')).toBe('y.md')
    expect(relativeLinkPath('notes/n.md', 'archive/y.md')).toBe('../archive/y.md')
  })

  it('notes/ の中のフォルダの深さに合わせて ../ を重ねる', () => {
    expect(relativeLinkPath('notes/案件A/定例/n.md', 'b.md')).toBe('../../../tickets/b.md')
    expect(relativeLinkPath('notes/案件A/n.md', 'notes/案件A/m.md')).toBe('m.md')
    expect(relativeLinkPath('notes/案件A/n.md', 'notes/共通/m.md')).toBe('../共通/m.md')
    expect(relativeLinkPath('notes/n.md', 'notes/案件A/定例/m.md')).toBe('案件A/定例/m.md')
    expect(relativeLinkPath('notes/案件A/定例/n.md', 'notes/m.md')).toBe('../../m.md')
    expect(relativeLinkPath('a.md', 'notes/案件A/m.md')).toBe('../notes/案件A/m.md')
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
