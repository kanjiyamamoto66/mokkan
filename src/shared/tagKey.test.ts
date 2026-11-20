import { describe, expect, it } from 'vitest'
import {
  groupTags,
  matchesTags,
  normalizeTagInput,
  splitTag,
  tagChipLabel,
  tagKeys,
  valuesOfKey
} from './tagKey'

describe('splitTag', () => {
  it('最初の / でキーと値に分ける', () => {
    expect(splitTag('顧客/A社')).toEqual({ key: '顧客', value: 'A社' })
    expect(splitTag('顧客/A社/大阪')).toEqual({ key: '顧客', value: 'A社/大阪' })
  })

  it('/ がない・先頭か最後にあるタグはキーなし', () => {
    expect(splitTag('急ぎ')).toEqual({ key: null, value: '急ぎ' })
    expect(splitTag('/A社')).toEqual({ key: null, value: '/A社' })
    expect(splitTag('顧客/')).toEqual({ key: null, value: '顧客/' })
  })
})

describe('normalizeTagInput', () => {
  it('全角の ／ を / にそろえる', () => {
    expect(normalizeTagInput('顧客／A社')).toBe('顧客/A社')
  })
})

describe('tagKeys・groupTags・valuesOfKey', () => {
  const tags = ['急ぎ', '種類/見積', '顧客/B社', '顧客/A社', '家']

  it('キーを名前順に返す', () => {
    expect(tagKeys(tags)).toEqual(['種類', '顧客'].sort((a, b) => a.localeCompare(b, 'ja')))
  })

  it('キーごとにまとめ、キーのないタグは最後', () => {
    const groups = groupTags(tags)
    expect(groups.at(-1)).toEqual({ key: null, tags: ['急ぎ', '家'] })
    expect(groups.find((g) => g.key === '顧客')?.tags).toEqual(['顧客/B社', '顧客/A社'])
  })

  it('キーの値を返す', () => {
    expect(valuesOfKey(tags, '顧客')).toEqual(['B社', 'A社'])
    expect(valuesOfKey(tags, '担当')).toEqual([])
  })
})

describe('matchesTags', () => {
  const item = ['顧客/A社', '種類/見積', '急ぎ']

  it('選んでいなければ合う', () => {
    expect(matchesTags(item, [])).toBe(true)
  })

  it('同じキーのタグどうしは「または」', () => {
    expect(matchesTags(item, ['顧客/A社', '顧客/B社'])).toBe(true)
    expect(matchesTags(item, ['顧客/B社', '顧客/C社'])).toBe(false)
  })

  it('違うキーどうしは「かつ」', () => {
    expect(matchesTags(item, ['顧客/A社', '種類/見積'])).toBe(true)
    expect(matchesTags(item, ['顧客/A社', '種類/請求'])).toBe(false)
  })

  it('キーのないタグどうしは「または」', () => {
    expect(matchesTags(item, ['急ぎ', '家'])).toBe(true)
    expect(matchesTags(['家'], ['急ぎ', '家'])).toBe(true)
    expect(matchesTags(['仕事'], ['急ぎ', '家'])).toBe(false)
  })

  it('キーのないタグとキーのあるタグは「かつ」', () => {
    expect(matchesTags(item, ['急ぎ', '顧客/A社'])).toBe(true)
    expect(matchesTags(['急ぎ'], ['急ぎ', '顧客/A社'])).toBe(false)
  })
})

describe('tagChipLabel', () => {
  const tags = ['顧客/A社', '顧客/B社', 'A社', '急ぎ']
  it('キーのあるタグは値だけにする', () => {
    expect(tagChipLabel('顧客/B社', tags)).toBe('B社')
  })
  it('キーのないタグに同じ名前があるときは全体を出す', () => {
    expect(tagChipLabel('顧客/A社', tags)).toBe('顧客/A社')
    expect(tagChipLabel('A社', tags)).toBe('A社')
  })
})
