import { describe, it, expect } from 'vitest'
import { chunkMarkdown } from '@/lib/ai/chunk'

describe('chunkMarkdown', () => {
  it('빈 문서 → 빈 배열', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })
  it('짧은 문서는 청크 1개', () => {
    const md = '# 제목\n\n본문 한 줄'
    expect(chunkMarkdown(md)).toEqual([md.trim()])
  })
  it('헤딩 경계로 분할', () => {
    const a = `# 안건 1\n${'가'.repeat(1000)}`
    const b = `## 안건 2\n${'나'.repeat(1000)}`
    const out = chunkMarkdown(`${a}\n${b}`, 1500)
    expect(out).toHaveLength(2)
    expect(out[0].startsWith('# 안건 1')).toBe(true)
    expect(out[1].startsWith('## 안건 2')).toBe(true)
  })
  it('헤딩 없는 긴 문서는 문단 경계로 분할', () => {
    const p = '문단'.repeat(300) // 600자
    const out = chunkMarkdown([p, p, p, p].join('\n\n'), 1500)
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out.every(c => c.length <= 1500)).toBe(true)
  })
  it('경계 없는 초장문은 강제 절단', () => {
    const out = chunkMarkdown('가'.repeat(4000), 1500)
    expect(out).toHaveLength(3)
    expect(out.every(c => c.length <= 1500)).toBe(true)
  })
})
