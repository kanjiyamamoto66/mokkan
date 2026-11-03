// 本文（frontmatter より後ろ）を書き出すときに、編集していないブロックを元のテキストのまま残す
//
// エディタ（Milkdown）は本文全体を書き出し直すので、編集していない段落でも
// `[` → `\[` のような書き方の違いが出ることがある。そこで、書き出した結果をブロック
// （段落・見出し・リスト・表など、一番外側の要素）に分け、エディタで読み込んだ直後の
// 書き出し結果と同じブロックは、元のファイルのテキストに置き換える。

import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

interface Block {
  start: number
  end: number
  text: string
  /** 書式を除いた文字だけ（記号の書き方やエスケープの違いを無視して中身を比べるため） */
  plain: string
}

interface MdNode {
  type: string
  value?: unknown
  alt?: unknown
  url?: unknown
  children?: MdNode[]
}

/** ブロックから書式を除いた文字を取り出す（リンクは表示する文字とURLの両方を含める） */
function plainText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  let text = ''
  if (typeof node.alt === 'string') text += node.alt
  if (node.children) text += node.children.map(plainText).join('')
  if (typeof node.url === 'string') text += `(${node.url})`
  return text
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** 一番外側のブロックと、その位置を返す */
export function splitBlocks(markdown: string): Block[] {
  const tree = parser.parse(markdown)
  return tree.children.flatMap((node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return []
    return [{ start, end, text: markdown.slice(start, end), plain: plainText(node as MdNode) }]
  })
}

/** 2つの列の最長共通部分列を、対応する添字の組で返す */
function matchBlocks(a: string[], b: string[]): Array<[number, number]> {
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/** 先頭の空行（frontmatter との間の空行） */
function leadingBlankLines(text: string): string {
  return /^(?:[ \t]*\r?\n)*/.exec(text)?.[0] ?? ''
}

/**
 * 元の本文と読み込み直後の書き出し結果で、i 番目のブロックどうしが同じ中身か
 * ブロックの数が同じで、書式を除いた文字もすべて同じなら対応させられる。
 * 数が違う（リンク参照定義 `[a]: URL` はエディタが本文中のリンクに展開して消すので減る）場合や、
 * 数は同じでも結合と分割が重なって中身がずれた場合は、対応が取れない
 */
function blocksCorrespond(o: Block[], b: Block[]): boolean {
  return o.length === b.length && o.every((block, i) => block.plain === b[i].plain)
}

/** 編集していないブロックを元のテキストのまま残せるか（編集画面は、残せない本文を開いたときに知らせる） */
export function canPreserveBlocks(original: string, baseline: string): boolean {
  return blocksCorrespond(splitBlocks(original), splitBlocks(baseline))
}

/**
 * 保存する本文を作る
 * @param original ファイルにある元の本文
 * @param baseline 元の本文をエディタで読み込んだ直後の書き出し結果
 * @param edited 編集後の書き出し結果
 * @returns 編集していないブロックを元のテキストのまま残した本文。実質的な変更がなければ original
 */
export function mergeBody(original: string, baseline: string, edited: string): string {
  if (edited === baseline) return original

  const o = splitBlocks(original)
  // 空のファイルに書くときだけ、frontmatter との間に空行を入れる
  const head = leadingBlankLines(original) || (o.length === 0 ? '\n' : '')
  const b = splitBlocks(baseline)
  const n = splitBlocks(edited)

  if (n.length === 0) return head
  // ブロックの対応が取れないと、元の別のブロックの文字を書き込んでしまうので、編集結果をそのまま使う
  // （本文全体が正式な書き方になる。編集画面は開いたときにこのことを知らせる。canPreserveBlocks を参照）
  if (!blocksCorrespond(o, b)) return head + edited.slice(n[0].start)

  // 編集後のブロック k が、元のブロック source[k] と同じ内容か（-1 なら新しい内容）
  const source = new Array<number>(n.length).fill(-1)
  for (const [j, k] of matchBlocks(
    b.map((x) => x.text),
    n.map((x) => x.text)
  )) {
    source[k] = j
  }

  // 書き換えたブロックが、元の同じ位置のブロックをその場で書き換えたものなら、その位置も持つ
  // （前後の空行や改行を元のまま残すため。中身は編集後のものを使う）
  const position = [...source]
  for (let k = 0; k < n.length;) {
    if (position[k] >= 0) {
      k++
      continue
    }
    let end = k
    while (end < n.length && source[end] < 0) end++
    const before = k > 0 ? source[k - 1] : -1
    const after = end < n.length ? source[end] : o.length
    if (end - k === after - before - 1) {
      for (let i = k; i < end; i++) position[i] = before + 1 + (i - k)
    }
    k = end
  }

  let result = head
  for (let k = 0; k < n.length; k++) {
    if (k > 0) {
      const prev = position[k - 1]
      const cur = position[k]
      // 元でも隣り合っていたブロックの間は、元の空行や改行をそのまま使う
      result +=
        prev >= 0 && cur === prev + 1
          ? original.slice(o[prev].end, o[cur].start)
          : edited.slice(n[k - 1].end, n[k].start)
    }
    result += source[k] >= 0 ? o[source[k]].text : n[k].text
  }
  const last = position[n.length - 1]
  result +=
    last === o.length - 1 && last >= 0
      ? original.slice(o[last].end)
      : edited.slice(n[n.length - 1].end)
  return result
}
