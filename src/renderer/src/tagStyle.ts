// タグの色を画面に付ける。色相だけを CSS の変数（--tag-h）で渡し、淡い色は main.css の .tag-colored が作る

import type { CSSProperties } from 'react'
import { tagHue, type TagColors } from '../../shared/tagColor'

/** タグの色を TAGS.md に書く（裏方に頼む）。書けなかったら理由を出す */
export function saveTagColor(tag: string, hue: number | null): void {
  window.api.setTagColor(tag, hue).catch((e: Error) => {
    window.alert(
      `タグの色を保存できませんでした：${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`
    )
  })
}

/** タグの色相を渡す style。class に tag-colored を付けた要素に使う */
export function tagStyle(tag: string, colors: TagColors): CSSProperties {
  return { '--tag-h': tagHue(tag, colors) } as CSSProperties
}
