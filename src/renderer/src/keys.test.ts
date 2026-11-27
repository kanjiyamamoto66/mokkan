import { describe, expect, it } from 'vitest'
import { backLabel, clickLabel, isBackKey, isModKey, keyLabel, redoLabel } from './keys'

describe('isModKey', () => {
  it('Windows・Linux は Ctrl だけ、Mac は ⌘ だけ（Mac の ⌃ は文字の移動と右クリックなので受け取らない）', () => {
    const ctrl = { ctrlKey: true, metaKey: false }
    const meta = { ctrlKey: false, metaKey: true }
    const both = { ctrlKey: true, metaKey: true }
    expect(isModKey(ctrl, false)).toBe(true)
    expect(isModKey(meta, false)).toBe(false)
    expect(isModKey(both, false)).toBe(false)
    expect(isModKey(meta, true)).toBe(true)
    expect(isModKey(ctrl, true)).toBe(false)
    expect(isModKey(both, true)).toBe(false)
  })
})

describe('keyLabel', () => {
  it('Windows は Ctrl+…、Mac は記号（⌃⌥⇧⌘ の順）', () => {
    expect(keyLabel('Mod+N', false)).toBe('Ctrl+N')
    expect(keyLabel('Mod+Alt+X', false)).toBe('Ctrl+Alt+X')
    expect(keyLabel('Mod+N', true)).toBe('⌘N')
    expect(keyLabel('Mod+Alt+X', true)).toBe('⌥⌘X')
    expect(keyLabel('Mod+Shift+Z', true)).toBe('⇧⌘Z')
    expect(keyLabel('Shift+Tab', true)).toBe('⇧Tab')
  })

  it('クリック・やり直す・戻る', () => {
    expect(clickLabel(false)).toBe('Ctrl+クリック')
    expect(clickLabel(true)).toBe('⌘+クリック')
    expect(redoLabel(false)).toBe('Ctrl+Y')
    expect(redoLabel(true)).toBe('⇧⌘Z')
    expect(backLabel(false)).toBe('Alt+←')
    expect(backLabel(true)).toBe('⌘[')
  })
})

describe('isBackKey', () => {
  const key = (
    k: string,
    mods: Partial<Record<'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey', boolean>>
  ): Parameters<typeof isBackKey>[0] => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods
  })

  it('Windows は Alt+←、Mac は ⌘[', () => {
    expect(isBackKey(key('ArrowLeft', { altKey: true }), false)).toBe(true)
    expect(isBackKey(key('[', { metaKey: true }), false)).toBe(false)
    expect(isBackKey(key('[', { metaKey: true }), true)).toBe(true)
    // Mac の ⌥← は単語の移動なので、戻るにしない
    expect(isBackKey(key('ArrowLeft', { altKey: true }), true)).toBe(false)
  })
})
