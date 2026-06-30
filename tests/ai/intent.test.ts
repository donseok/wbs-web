import { describe, it, expect } from 'vitest'
import { classifyIntent, needsSemantic, isCrossProject, QUICK_SUGGESTIONS } from '@/lib/ai/intent'

describe('classifyIntent — 빠른 질문 칩', () => {
  it('이미지의 5개 칩이 의도로 매핑된다', () => {
    expect(classifyIntent('전체 프로젝트 현황 알려줘')).toBe('overview')
    expect(classifyIntent('지연된 작업이 뭐야?')).toBe('delayed')
    expect(classifyIntent('이번 주 작업 알려줘')).toBe('this_week')
    expect(classifyIntent('멤버별 업무 정리해줘')).toBe('by_team')
    expect(classifyIntent('완료된 작업 목록 보여줘')).toBe('completed')
  })
})

describe('classifyIntent — 프로액티브/주간', () => {
  it('이번 주 시작 예정', () => {
    expect(classifyIntent('이번 주 시작 작업 알려줘')).toBe('this_week_start')
    expect(classifyIntent('이번 주 시작 3건')).toBe('this_week_start')
    expect(classifyIntent('금주 시작 예정 작업')).toBe('this_week_start')
  })
  it('주간 요약', () => {
    expect(classifyIntent('주간 요약')).toBe('weekly_summary')
    expect(classifyIntent('이번 주 한 주 정리 리포트')).toBe('weekly_summary')
  })
})

describe('classifyIntent — 경계/함정', () => {
  it('"미완료"는 완료로 분류하지 않는다', () => {
    expect(classifyIntent('미완료 작업 보여줘')).not.toBe('completed')
  })
  it('현황/공정률/진척 → project_status', () => {
    expect(classifyIntent('공정률이 어떻게 돼?')).toBe('project_status')
    expect(classifyIntent('지금 어디까지 진행됐어?')).toBe('project_status')
    expect(classifyIntent('진척 상태 알려줘')).toBe('project_status')
  })
  it('지연 키워드 변형', () => {
    expect(classifyIntent('밀린 작업 있어?')).toBe('delayed')
    expect(classifyIntent('일정 지체된 거')).toBe('delayed')
  })
  it('매칭 안 되면 freeform', () => {
    expect(classifyIntent('계량대 설치 담당 연락처 알려줘')).toBe('freeform')
  })

  it('"전체 프로젝트 + 완료/지연"은 단일 프로젝트가 아니라 전사(overview)로', () => {
    expect(classifyIntent('전체 프로젝트 완료율 알려줘')).toBe('overview')
    expect(classifyIntent('전체 프로젝트 지연 현황')).toBe('overview')
    expect(classifyIntent('전사 현황')).toBe('overview')
  })

  it('"프로젝트" 없는 총칭어는 전사로 오인하지 않는다', () => {
    expect(classifyIntent('모두 완료된 작업 보여줘')).toBe('completed')
    expect(classifyIntent('전체 작업 지연된 거')).toBe('delayed')
  })
})

describe('보조 헬퍼', () => {
  it('freeform 만 의미검색 필요', () => {
    expect(needsSemantic('freeform')).toBe(true)
    expect(needsSemantic('delayed')).toBe(false)
  })
  it('overview 만 전사 스코프', () => {
    expect(isCrossProject('overview')).toBe(true)
    expect(isCrossProject('project_status')).toBe(false)
  })
  it('빠른 질문 칩은 5개', () => {
    expect(QUICK_SUGGESTIONS).toHaveLength(5)
  })
})
