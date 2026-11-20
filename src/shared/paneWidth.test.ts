import { describe, expect, it } from 'vitest'
import { asEditorWidth, asPaneWidths, clampEditorWidth } from './paneWidth'

describe('asEditorWidth', () => {
  it('下限から上限までの数を整数にして返す', () => {
    expect(asEditorWidth(500.4)).toBe(500)
    expect(asEditorWidth(360)).toBe(360)
  })

  it('狭すぎる・広すぎる・数でない値は null', () => {
    expect(asEditorWidth(359)).toBeNull()
    expect(asEditorWidth(4001)).toBeNull()
    expect(asEditorWidth(Number.NaN)).toBeNull()
    expect(asEditorWidth('500')).toBeNull()
    expect(asEditorWidth(null)).toBeNull()
  })
})

describe('asPaneWidths', () => {
  it('知っている画面の、使える幅だけを残す', () => {
    expect(asPaneWidths({ list: 600, gantt: 100, other: 500, notes: '700' })).toEqual({
      list: 600
    })
  })

  it('対応表でなければ空', () => {
    expect(asPaneWidths(null)).toEqual({})
    expect(asPaneWidths([600])).toEqual({})
    expect(asPaneWidths('list')).toEqual({})
  })
})

describe('clampEditorWidth', () => {
  it('一覧が下限（260px）より狭くならないようにする', () => {
    expect(clampEditorWidth(900, 1000)).toBe(740)
  })

  it('編集画面は下限（360px）より狭くしない', () => {
    expect(clampEditorWidth(100, 1000)).toBe(360)
    // 全体が狭くても、編集画面の下限は守る
    expect(clampEditorWidth(500, 400)).toBe(360)
  })

  it('間の幅はそのまま', () => {
    expect(clampEditorWidth(512.6, 1200)).toBe(513)
  })
})
