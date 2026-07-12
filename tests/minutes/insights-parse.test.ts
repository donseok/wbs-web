import { describe, it, expect } from 'vitest'
import { parseInsightItems } from '@/lib/ai/minutes-insights'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'

const MD = '# 제목\n\n결정 문단\n\n<div>raw</div>\n\n기한 문단'
const blocks = splitMinuteBlocks(MD)  // 0=heading, 1=결정, 2=raw(비렌더), 3=기한

describe('parseInsightItems', () => {
  it('코드펜스·서두 문장 제거 후 파싱', () => {
    const raw = '다음과 같습니다.\n```json\n[{"i":1,"k":"decision","label":"확정"}]\n```'
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 1, k: 'decision', label: '확정' }])
  })
  it('잘못된 kind·범위 밖 인덱스·비렌더 블록 인덱스 드롭', () => {
    const raw = JSON.stringify([
      { i: 1, k: 'decision', label: 'ok' },
      { i: 2, k: 'action', label: 'raw html 블록' },   // 비렌더 → 드롭
      { i: 99, k: 'risk', label: '범위 밖' },
      { i: 3, k: 'banana', label: '엉뚱 kind' },
    ])
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 1, k: 'decision', label: 'ok' }])
  })
  it('label 120자 캡 + (블록, kind) 중복 제거 + 30개 캡', () => {
    const long = 'x'.repeat(300)
    const raw = JSON.stringify([
      { i: 1, k: 'decision', label: long },
      { i: 1, k: 'decision', label: '중복' },
      { i: 1, k: 'deadline', label: '다른 kind 는 허용' },
    ])
    const out = parseInsightItems(raw, blocks)!
    expect(out).toHaveLength(2)
    expect(out[0].label).toHaveLength(120)
  })
  it('깨진 JSON → null', () => {
    expect(parseInsightItems('죄송합니다, 분류할 수 없습니다.', blocks)).toBeNull()
    expect(parseInsightItems('[{"i":1,', blocks)).toBeNull()
  })
  it('배열 아닌 JSON → null, 빈 배열 → []', () => {
    expect(parseInsightItems('{"i":1}', blocks)).toBeNull()
    expect(parseInsightItems('[]', blocks)).toEqual([])
  })
  it('label 이 문자열 아닌 항목 드롭', () => {
    const raw = JSON.stringify([{ i: 1, k: 'risk', label: 42 }, { i: 3, k: 'risk', label: '유효' }])
    expect(parseInsightItems(raw, blocks)).toEqual([{ i: 3, k: 'risk', label: '유효' }])
  })
})
