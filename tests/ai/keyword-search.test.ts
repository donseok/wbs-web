import { describe, it, expect } from 'vitest'
import { extractSearchKeywords, classifyIntent } from '@/lib/ai/intent'
import { keywordMatchLines, analyzeProject } from '@/lib/ai/analytics'
import type { ComputedItem } from '@/lib/domain/types'

describe('extractSearchKeywords — 키워드 검색 질문 감지', () => {
  it('"X 단어가 들어간" 패턴 (사용자 실제 질문)', () => {
    expect(extractSearchKeywords('wbs에서 tft 단어가 들어간 항목들 검색해줘')).toEqual(['tft'])
  })
  it('따옴표 인용', () => {
    expect(extractSearchKeywords("'TFT' 들어간 작업 보여줘")).toEqual(['tft'])
    expect(extractSearchKeywords('"기준정보" 포함된 항목 알려줘')).toEqual(['기준정보'])
  })
  it('스마트 따옴표(macOS/iOS 자동 변환) 인용', () => {
    expect(extractSearchKeywords('‘tft’ 가 들어간 작업 알려줘')).toEqual(['tft'])
    expect(extractSearchKeywords('“MES” 라는 단어가 포함된 작업 검색')).toEqual(['mes'])
  })
  it("어포스트로피(D'Flow, John's)를 여는 따옴표로 오인하지 않는다", () => {
    expect(extractSearchKeywords("D'Flow에서 'tft' 들어간 작업 찾아줘")).toEqual(['tft'])
    expect(extractSearchKeywords("John's 작업이랑 Kim's 작업 찾아줘")).toEqual([])
  })
  it('"X라는 단어" 패턴 — 한국어 키워드', () => {
    expect(extractSearchKeywords('기준정보라는 단어가 들어간 작업 알려줘')).toEqual(['기준정보'])
  })
  it('"X란 단어" 축약 어미도 벗긴다', () => {
    expect(extractSearchKeywords('설계란 단어가 들어간 작업 보여줘')).toEqual(['설계'])
    expect(extractSearchKeywords('품질이란 글자가 포함된 작업')).toEqual(['품질'])
  })
  it('명사 수식어 없이 ASCII 토큰 + 포함/들어간 (조사 은/는/도/만 포함)', () => {
    expect(extractSearchKeywords('ERP 들어간 항목 찾아줘')).toEqual(['erp'])
    expect(extractSearchKeywords('MES 포함된 작업')).toEqual(['mes'])
    expect(extractSearchKeywords('tft도 들어간 작업 있어?')).toEqual(['tft'])
    expect(extractSearchKeywords('A/S가 포함된 작업 검색')).toEqual(['a/s'])
  })
  it('"X로 검색" 패턴', () => {
    expect(extractSearchKeywords('tft로 검색해줘')).toEqual(['tft'])
  })
  it('일반 질문에서는 키워드를 만들지 않는다 (오탐 방지)', () => {
    expect(extractSearchKeywords('지연된 작업이 뭐야?')).toEqual([])
    expect(extractSearchKeywords('이번 주 일정이 포함된 보고서 만들어줘')).toEqual([])
    expect(extractSearchKeywords('프로젝트 현황 알려줘')).toEqual([])
    expect(extractSearchKeywords('어떤 단어가 들어간 작업이 많아?')).toEqual([])
  })
  it('검색 의도 신호가 없으면 따옴표 인용도 추출하지 않는다 (변경/일반 대화 게이트)', () => {
    expect(extractSearchKeywords("담당자를 '김철수'로 변경하고 싶어")).toEqual([])
    expect(extractSearchKeywords("고객이 '빨리 해달라'고 했는데 뭐부터 하지?")).toEqual([])
    expect(extractSearchKeywords("'설계 검토' 다음에 뭐 해야 해?")).toEqual([])
  })
  it('따옴표로 명시 인용한 키워드는 불용어 필터를 우회한다', () => {
    expect(extractSearchKeywords("'wbs' 단어가 들어간 항목")).toEqual(['wbs'])
  })
  it('불용어·중복 제거 + 소문자 정규화', () => {
    expect(extractSearchKeywords("'TFT' 그리고 'tft' 가 들어간 항목")).toEqual(['tft'])
    expect(extractSearchKeywords('wbs 검색해줘')).toEqual([])
  })
})

describe('classifyIntent — 키워드 검색이 구조화 의도를 선점', () => {
  it('의도어(지연/완료)가 섞여도 문자열 검색 질문이면 freeform', () => {
    expect(classifyIntent('지연 단어가 들어간 항목 검색해줘')).toBe('freeform')
    expect(classifyIntent("'완료' 라는 단어가 포함된 작업 찾아줘")).toBe('freeform')
  })
  it('키워드 없는 구조화 질문은 기존 의도 유지', () => {
    expect(classifyIntent('지연된 작업 찾아줘')).toBe('delayed')
    expect(classifyIntent('완료된 작업 목록 보여줘')).toBe('completed')
  })
})

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2),
  parentId: 'P',
  level: 'activity',
  code: '1',
  sortOrder: 1,
  name: 'task',
  biz: null,
  deliverable: null,
  plannedStart: null,
  plannedEnd: null,
  weight: null,
  actualPct: null,
  owners: [],
  plannedPct: 0,
  rolledActualPct: 0,
  achievement: null,
  status: 'not_started',
  children: [],
  ...over,
})
const phase = (children: ComputedItem[]): ComputedItem => ({
  ...leaf({}),
  level: 'phase',
  name: '1. 준비',
  children,
})

describe('keywordMatchLines — 팩트시트 키워드 필터', () => {
  const items = [
    phase([
      leaf({ name: 'TFT R&R 확정' }),
      leaf({ name: '기준정보 정의' }),
      leaf({ name: '상세기능 정의', biz: 'TFT 협의 후 확정' }),
      leaf({ name: '벤더 평가', deliverable: '평가표' }),
    ]),
  ]
  const analysis = analyzeProject(items, '테스트', '2026-07-02')

  it('이름/업무에서 대소문자 무시 부분 일치', () => {
    const r = keywordMatchLines(analysis, ['tft'])
    expect(r.total).toBe(2)
    expect(r.lines[0]).toContain('TFT R&R 확정')
    expect(r.lines[1]).toContain('상세기능 정의')
  })
  it('일치 없음 → total 0', () => {
    expect(keywordMatchLines(analysis, ['없는말']).total).toBe(0)
  })
  it('키워드 비면 빈 결과', () => {
    expect(keywordMatchLines(analysis, []).total).toBe(0)
  })
  it('max 상한 초과분은 잘라내되 total 은 전체 수', () => {
    const r = keywordMatchLines(analysis, ['정의'], 1)
    expect(r.total).toBe(2)
    expect(r.lines).toHaveLength(1)
  })
})
