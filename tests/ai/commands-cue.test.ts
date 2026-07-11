import { describe, it, expect } from 'vitest'
import { isCommandUtterance } from '@/lib/ai/commands/cue'

describe('isCommandUtterance — 쓰기 명령 게이트 (보수적)', () => {
  it.each([
    'ERP 인터페이스 설계 실적 80으로 올려줘',
    'TFT R&R 확정 완료 처리해줘',
    '킥오프 준비 완료로 바꿔줘',
    '기준정보 정제 종료일 8월 20일로 미뤄줘',
    '마스터플랜 수립 실적 50%로 변경',
  ] as const)('명령으로 감지: %s', text => {
    expect(isCommandUtterance(text)).toBe(true)
  })
  it.each([
    '지연된 작업이 뭐야?',
    '전체 프로젝트 현황 알려줘',
    '완료된 작업 목록 보여줘',       // '완료' 포함하지만 조회 — 오탐 금지
    '이번 주 작업 알려줘',
    '실적이 낮은 작업 정리해줘',      // '정리해줘'는 조회성
    "'인터페이스' 들어간 항목 찾아줘",
  ] as const)('조회로 통과: %s', text => {
    expect(isCommandUtterance(text)).toBe(false)
  })
})
