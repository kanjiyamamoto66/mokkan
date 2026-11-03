import { describe, expect, it } from 'vitest'
import { canPreserveBlocks, mergeBody, splitBlocks } from './body'

// 元の本文は正式でない書き方を含む（エディタは「* 項目」を「- 項目」、「[x]」を「\[x]」と書き出す）
const original = '\n# タイトル\n\n* 項目A\n* 項目B\n\n[角括弧] の段落\n\n最後の段落\n'
const baseline = '# タイトル\n\n- 項目A\n- 項目B\n\n\\[角括弧] の段落\n\n最後の段落\n'

describe('splitBlocks', () => {
  it('一番外側のブロックに分ける', () => {
    expect(splitBlocks(original).map((b) => b.text)).toEqual([
      '# タイトル',
      '* 項目A\n* 項目B',
      '[角括弧] の段落',
      '最後の段落'
    ])
  })
})

describe('mergeBody', () => {
  it('編集していなければ元の本文を返す', () => {
    expect(mergeBody(original, baseline, baseline)).toBe(original)
  })

  it('編集したブロックだけを差し替える', () => {
    const edited = baseline.replace('最後の段落', '最後の段落を直した')
    expect(mergeBody(original, baseline, edited)).toBe(
      original.replace('最後の段落', '最後の段落を直した')
    )
  })

  it('先頭のブロックを編集しても、frontmatter との間の空行は残す', () => {
    const edited = baseline.replace('# タイトル', '# 新しいタイトル')
    expect(mergeBody(original, baseline, edited)).toBe(
      original.replace('# タイトル', '# 新しいタイトル')
    )
  })

  it('ブロックを足しても、ほかのブロックは元のまま', () => {
    const edited = baseline.replace('最後の段落\n', '最後の段落\n\n- [ ] 追加したやること\n')
    expect(mergeBody(original, baseline, edited)).toBe(
      original.replace('最後の段落\n', '最後の段落\n\n- [ ] 追加したやること\n')
    )
  })

  it('ブロックを消しても、ほかのブロックは元のまま', () => {
    const edited = baseline.replace('\\[角括弧] の段落\n\n', '')
    expect(mergeBody(original, baseline, edited)).toBe(original.replace('[角括弧] の段落\n\n', ''))
  })

  it('その場で書き換えたブロックの前後の空行や改行は、元のまま残す', () => {
    // 見出しとリストの間に空行がない書き方（エディタは空行を入れて書き出す）
    const o = '\n## メモ\n- [ ] 病院\n- [ ] 薬局\n\n最後\n'
    const b = '## メモ\n\n- [ ] 病院\n- [ ] 薬局\n\n最後\n'
    const edited = b.replace('- [ ] 病院', '- [x] 病院')
    expect(mergeBody(o, b, edited)).toBe(o.replace('- [ ] 病院', '- [x] 病院'))
  })

  it('最後のブロックを書き換えても、末尾の改行は元のまま', () => {
    const o = '\n# タイトル\n\n最後'
    const b = '# タイトル\n\n最後\n'
    expect(mergeBody(o, b, b.replace('最後', '最後を直した'))).toBe('\n# タイトル\n\n最後を直した')
  })

  it('全部消したら空行だけ残す', () => {
    expect(mergeBody(original, baseline, '')).toBe('\n')
  })

  it('空の本文に書くときは、frontmatter との間に空行を入れる', () => {
    expect(mergeBody('', '', '# タイトル\n')).toBe('\n# タイトル\n')
  })

  it('ブロックの数が同じでも中身がずれていたら、元の別のブロックの文字を書き込まない', () => {
    // 読み込み直後の書き出しで、ブロックの並びがずれた場合を想定
    const o = '\n段落A\n\n段落B\n'
    const b = '段落B\n\n段落A\n'
    expect(canPreserveBlocks(o, b)).toBe(false)
    // 対応を数だけで判断すると、「段落B」の位置に元の「段落A」を書き込んでしまう
    const edited = '段落B\n\n段落Aを直した\n'
    expect(mergeBody(o, b, edited)).toBe('\n段落B\n\n段落Aを直した\n')
  })

  it('書き方が違うだけなら、中身は同じとみなして元のテキストを残せる', () => {
    expect(canPreserveBlocks(original, baseline)).toBe(true)
    expect(
      canPreserveBlocks(
        '\n見出し\n===\n\nhttps://example.com\n',
        '# 見出し\n\n<https://example.com>\n'
      )
    ).toBe(true)
    expect(canPreserveBlocks('\n_斜体_ と __強調__\n', '*斜体* と **強調**\n')).toBe(true)
  })

  it('元と読み込み直後でブロックの数が違うときは、編集結果をそのまま使う', () => {
    // エディタが空の見出しを読み飛ばす場合など
    expect(mergeBody('\n#\n', '', '# 見出し\n')).toBe('\n# 見出し\n')
  })
})
