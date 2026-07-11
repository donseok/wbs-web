import { describe, it, expect } from 'vitest'
import { isCommandUtterance } from '@/lib/ai/commands/cue'

describe('isCommandUtterance — 쓰기 명령 게이트 (보수적)', () => {
  it.each([
    'ERP 인터페이스 설계 실적 80으로 올려줘',
    'TFT R&R 확정 완료 처리해줘',
    '킥오프 준비 완료로 바꿔줘',
    '기준정보 정제 종료일 8월 20일로 미뤄줘',
    '마스터플랜 수립 실적 50%로 변경',
    '일정 8월 20일로 변경해 주세요',
    '실적 60으로 올려 주세요',
    '이 작업 완료로 해줘',
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
    '당겨서 진행하면 좋을지 검토해줘', // 어간만 — 명령 아님
    '일정 변경해야 하는지 알려줘',     // 어간만 — 명령 아님
    '완료로 간주해도 될지 확인 부탁해', // 어간만 — 명령 아님
    '미뤄지면 큰일이다',              // 어간만 — 명령 아님
    '완료 처리 여부를 확인해주세요', // 어간/명사구만 — 명령 아님
    '완료 처리하면 문제 없는지 검토 부탁해', // 어간/명사구만 — 명령 아님
  ] as const)('조회로 통과: %s', text => {
    expect(isCommandUtterance(text)).toBe(false)
  })
})
