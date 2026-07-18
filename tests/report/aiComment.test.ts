import { describe, it, expect } from 'vitest'
import { briefToExtraSlide, splitBriefSections } from '@/lib/report/aiComment'

const BODY = [
  '## 진행 현황',
  '- 전체 실적 40.5%로 계획 대비 뒤처짐',
  '- 설계 단계는 마무리 국면',
  '',
  '## 리스크',
  '- 지연 작업 2건 누적',
  '## 이번 주 권고',
  '- 만회 일정 합의 필요',
].join('\n')

describe('splitBriefSections', () => {
  it("'##' 섹션 단위 분해 + 불릿은 '.' 상세 마커로 통일", () => {
    const s = splitBriefSections(BODY)
    expect(s.map(x => x.name)).toEqual(['진행 현황', '리스크', '이번 주 권고'])
    expect(s[0].items).toEqual(['. 전체 실적 40.5%로 계획 대비 뒤처짐', '. 설계 단계는 마무리 국면'])
  })
  it('섹션 헤더 없는 서두 줄은 무명 섹션으로 보존(정보 유실 금지)', () => {
    const s = splitBriefSections('서두 한 줄\n## 리스크\n- 항목')
    expect(s[0]).toEqual({ name: '', items: ['. 서두 한 줄'] })
  })
  it('빈 본문 → 빈 배열', () => {
    expect(splitBriefSections('')).toEqual([])
  })
})

describe('briefToExtraSlide', () => {
  it('좌=헤드라인+진행 현황, 우=리스크·권고+생성 정보로 배치한다', () => {
    const slide = briefToExtraSlide({ headline: '지연 관리가 관건', bodyMd: BODY }, '2026-07-19 14:00')
    expect(slide.left.title).toBe('AI 종합 코멘트')
    expect(slide.left.groups[0].phase).toBe('지연 관리가 관건')
    expect(slide.left.groups.map(g => g.phase)).toContain('진행 현황')
    expect(slide.right.title).toBe('주요 리스크·제언')
    expect(slide.right.groups.map(g => g.phase)).toEqual(['리스크', '이번 주 권고', '생성 정보'])
    expect(slide.right.groups.at(-1)!.items[0]).toBe('. 2026-07-19 14:00 생성 · 수치는 대시보드 기준')
  })

  it('헤드라인 부재(수치 검증기 제거 등)면 좌셀 헤더는 이번 주 요약으로 폴백', () => {
    const slide = briefToExtraSlide({ headline: '  ', bodyMd: BODY }, 't')
    expect(slide.left.groups[0].phase).toBe('이번 주 요약')
  })

  it('미분류 섹션은 좌셀로(정보 유실 금지), 제언 계열은 우셀로', () => {
    const slide = briefToExtraSlide(
      { headline: 'h', bodyMd: '## 기타 참고\n- 참고 항목\n## 제언\n- 권고 항목' }, 't')
    expect(slide.left.groups.map(g => g.phase)).toContain('기타 참고')
    expect(slide.right.groups.map(g => g.phase)).toContain('제언')
  })
})
