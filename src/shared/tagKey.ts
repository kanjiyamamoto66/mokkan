// キーと値のタグ（`顧客/A社` のように、最初の `/` の前をキー、後ろを値とする）
// frontmatter では tags の一覧の1つの文字として書く（ほかのツールでも1つのタグとして扱われる）
// `キー: 値` は YAML の flow の一覧の中で対応表として読まれてしまうので、区切りは `/` にする

/** キーと値の区切り */
export const TAG_KEY_SEPARATOR = '/'

export interface SplitTag {
  /** キー。キーのないタグ（`/` がない、または `/` が先頭か最後）は null */
  key: string | null
  /** 値。キーのないタグはタグそのもの */
  value: string
}

/** タグをキーと値に分ける。最初の `/` で分け、後ろは全部を値とする（`顧客/A社/大阪` → `顧客` と `A社/大阪`） */
export function splitTag(tag: string): SplitTag {
  const at = tag.indexOf(TAG_KEY_SEPARATOR)
  if (at <= 0 || at === tag.length - 1) return { key: null, value: tag }
  return { key: tag.slice(0, at), value: tag.slice(at + 1) }
}

/** 入力で使われやすい全角の `／` を、区切りの `/` にそろえる */
export function normalizeTagInput(tag: string): string {
  return tag.replace(/／/g, TAG_KEY_SEPARATOR)
}

/** タグの一覧に出てくるキー（名前順） */
export function tagKeys(tags: Iterable<string>): string[] {
  const keys = new Set<string>()
  for (const tag of tags) {
    const { key } = splitTag(tag)
    if (key !== null) keys.add(key)
  }
  return [...keys].sort((a, b) => a.localeCompare(b, 'ja'))
}

export interface TagGroup {
  /** キー。キーのないタグのまとまりは null */
  key: string | null
  /** そのキーのタグ（`顧客/A社` の全体）。並びは渡した順 */
  tags: string[]
}

/** タグをキーごとにまとめる。キーの名前順で、キーのないタグは最後 */
export function groupTags(tags: string[]): TagGroup[] {
  const groups = new Map<string | null, string[]>()
  for (const tag of tags) {
    const { key } = splitTag(tag)
    groups.set(key, [...(groups.get(key) ?? []), tag])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1
      if (b === null) return -1
      return a.localeCompare(b, 'ja')
    })
    .map(([key, list]) => ({ key, tags: list }))
}

/**
 * 選んだタグで絞り込むときに、合うか
 * - 同じキーのタグどうしは「または」（顧客/A社 か 顧客/B社）
 * - 違うキーどうしは「かつ」（顧客/A社 で、しかも 種類/見積）
 * - キーのないタグは、まとめて1つのキーのように扱う（キーのないタグどうしは「または」）
 * @param selected 選んだタグ。空なら絞り込まない
 */
export function matchesTags(itemTags: readonly string[], selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  return groupTags([...selected]).every((group) => group.tags.some((t) => itemTags.includes(t)))
}

/** キーの値ごとにまとめるときの、そのキーの値（そのキーのタグがなければ空） */
export function valuesOfKey(tags: readonly string[], key: string): string[] {
  return tags.map(splitTag).flatMap((t) => (t.key === key ? [t.value] : []))
}

/**
 * 絞り込みのチップに出す名前。キーのあるタグはキーのまとまりの中に値だけを出すが、
 * キーのないタグに同じ名前があるとき（`顧客/A社` と `A社`）は、見分けられるように全体を出す
 */
export function tagChipLabel(tag: string, tags: readonly string[]): string {
  const { key, value } = splitTag(tag)
  if (key === null) return tag
  return tags.includes(value) ? tag : value
}
