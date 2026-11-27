// キーの組み合わせの表示（Windows・Linux は Ctrl+N、Mac は ⌘N）と、Ctrl（Mac は ⌘）が押されているかの判定。
// アプリのキー（App.tsx の新規・SearchBox.tsx の検索・idLinks.ts のクリック）は isModKey で受け取る。
// エディタ（Milkdown）のショートカットは Mod- で書かれていて、Mac では ⌘ になる

/** Mac で動いているか */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

/**
 * Ctrl（Mac は ⌘）が押されているか。Mac の ⌃ は文字の移動（⌃N で次の行・⌃K で行末まで消す）や
 * 右クリック（⌃+クリック）に使われるので、アプリのキーとしては受け取らない
 */
export function isModKey(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>, mac = IS_MAC): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Mod: '⌘'
}
/** Mac の記号の並び順（Apple の決まり：⌃⌥⇧⌘） */
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod']

/**
 * `Mod+Alt+X` のような書き方を、その OS の表示にする
 * - Windows：`Ctrl+Alt+X`（Mod は Ctrl）
 * - Mac：`⌥⌘X`
 */
export function keyLabel(spec: string, mac = IS_MAC): string {
  const parts = spec.split('+')
  const key = parts.pop() ?? ''
  if (!mac) return [...parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)), key].join('+')
  const mods = [...parts].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
  return mods.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key
}

/** Ctrl+クリック（Mac は ⌘+クリック）の表示 */
export function clickLabel(mac = IS_MAC): string {
  return mac ? '⌘+クリック' : 'Ctrl+クリック'
}

/** やり直すのキー（Windows は Ctrl+Y、Mac は ⇧⌘Z） */
export function redoLabel(mac = IS_MAC): string {
  return keyLabel(mac ? 'Mod+Shift+Z' : 'Mod+Y', mac)
}

/** 「← 戻る」のキー（Windows は Alt+←、Mac は ⌘[。Mac の ⌥← は文字の移動なので使わない） */
export function backLabel(mac = IS_MAC): string {
  return mac ? '⌘[' : 'Alt+←'
}

/** 「← 戻る」のキーか */
export function isBackKey(
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>,
  mac = IS_MAC
): boolean {
  if (mac) return e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === '['
  return e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && e.key === 'ArrowLeft'
}
