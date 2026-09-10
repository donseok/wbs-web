// @vitest-environment jsdom
/**
 * 번호 목록의 자릿수(--ol-digits) — globals.css 가 이 값만큼 들여쓰기를 늘려 두 자리 이상
 * 번호가 목록 상자(hover 테두리·마킹 선) 밖으로 튀어나오지 않게 한다. 자릿수는 목록의 마지막
 * 번호(start + 항목 수 − 1) 기준이다.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '@/components/minutes/MarkdownView'

function olTags(md: string): string[] {
  return [...renderToStaticMarkup(<MarkdownView content={md} />).matchAll(/<ol\b[^>]*>/g)].map(m => m[0])
}

const numbered = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => `${start + i}. 항목 ${i + 1}`).join('\n')

describe('번호 목록 자릿수', () => {
  it('한 자리 목록은 1', () => {
    expect(olTags(numbered(1, 3))).toEqual([expect.stringContaining('--ol-digits:1')])
  })

  it('마지막 번호가 두 자리면 2 — 1부터 10개도 포함', () => {
    expect(olTags(numbered(1, 10))[0]).toContain('--ol-digits:2')
    const tag = olTags(numbered(31, 5))[0]
    expect(tag).toContain('start="31"')
    expect(tag).toContain('--ol-digits:2')
  })

  it('마지막 번호가 세 자리면 3', () => {
    expect(olTags(numbered(98, 3))[0]).toContain('--ol-digits:3')
  })

  it('중첩 번호 목록도 제 자릿수를 따로 갖는다', () => {
    const tags = olTags('9. 항목\n10. 항목\n11. 항목\n    1. 안쪽 하나\n    2. 안쪽 둘')
    expect(tags).toHaveLength(2)
    expect(tags[0]).toContain('--ol-digits:2')
    expect(tags[1]).toContain('--ol-digits:1')
  })

  it('마킹 앵커(data-mblock)는 그대로 유지한다', () => {
    expect(olTags(numbered(31, 2))[0]).toMatch(/data-mblock="0"/)
  })
})
