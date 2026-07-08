import { describe, it, expect } from 'vitest'
import {
  MINUTES_CTX_MAX_CHARS,
  truncateForContext, buildMinutesSystemPrompt, presetPrompt,
} from '@/lib/ai/minutes-chat'
import type { MinutesPreset } from '@/lib/domain/types'

const META = { title: 'ERP 킥오프', minutesDate: '2026-07-08', teamCode: 'ERP' as const, projectName: 'D-CUBE' }

describe('truncateForContext', () => {
  it('상한 이하면 원문 그대로', () => {
    expect(truncateForContext('hello', 100)).toEqual({ text: 'hello', truncated: false })
  })
  it('경계값(정확히 max)은 자르지 않는다', () => {
    const md = 'a'.repeat(100)
    expect(truncateForContext(md, 100)).toEqual({ text: md, truncated: false })
  })
  it('초과하면 자르고 truncated:true', () => {
    const md = 'a'.repeat(500) + 'TAIL'
    const r = truncateForContext(md, 100)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(100 + 80) // 중략 마커 여유
  })
  it('머리와 꼬리를 보존한다', () => {
    const md = 'HEAD' + 'x'.repeat(1000) + 'TAIL'
    const r = truncateForContext(md, 100)
    expect(r.text.startsWith('HEAD')).toBe(true)
    expect(r.text.endsWith('TAIL')).toBe(true)
  })
  it('중략 마커에 생략 글자수를 적는다', () => {
    const md = 'x'.repeat(1000)
    const r = truncateForContext(md, 100)
    expect(r.text).toContain('중략')
    expect(r.text).toContain('1000')
  })
  it('기본 상한은 MINUTES_CTX_MAX_CHARS', () => {
    expect(truncateForContext('x'.repeat(MINUTES_CTX_MAX_CHARS)).truncated).toBe(false)
    expect(truncateForContext('x'.repeat(MINUTES_CTX_MAX_CHARS + 1)).truncated).toBe(true)
  })
})

describe('buildMinutesSystemPrompt', () => {
  it('메타 4개를 모두 담는다', () => {
    const s = buildMinutesSystemPrompt(META, '# 본문', false)
    expect(s).toContain('ERP 킥오프')
    expect(s).toContain('2026-07-08')
    expect(s).toContain('ERP')
    expect(s).toContain('D-CUBE')
    expect(s).toContain('# 본문')
  })
  it('문서 밖 지식 사용을 금지한다', () => {
    expect(buildMinutesSystemPrompt(META, '본문', false)).toContain('문서에 없는')
  })
  it('truncated 면 발췌본임을 알린다', () => {
    const s = buildMinutesSystemPrompt(META, '본문', true)
    expect(s).toContain('발췌본')
    expect(s).toContain('원문에서 확인 필요')
  })
  it('truncated 가 false 면 발췌본 문장이 없다', () => {
    expect(buildMinutesSystemPrompt(META, '본문', false)).not.toContain('발췌본')
  })
})

describe('presetPrompt', () => {
  const all: MinutesPreset[] = ['summary', 'decisions', 'actions', 'risks']
  it('4종 모두 비어있지 않다', () => {
    for (const p of all) expect(presetPrompt(p).length).toBeGreaterThan(0)
  })
  it('4종이 서로 다르다', () => {
    expect(new Set(all.map(presetPrompt)).size).toBe(4)
  })
})
