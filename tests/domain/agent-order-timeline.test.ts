import { describe, expect, it } from 'vitest'
import { orderTimeline } from '@/lib/domain/agentWork'

const rep = (kind: 'progress' | 'completion', created_at: string) => ({ kind, created_at })

describe('orderTimeline — 명세 패널 진행 요약', () => {
  it('완료 보고된 주문은 마지막 completion 에서 끝나고 진행 분을 센다', () => {
    const t = orderTimeline({
      status: 'reported', claimed_at: '2026-09-23T14:00:00Z', heartbeat_model: 'claude-opus-4-8', last_heartbeat_at: '2026-09-23T14:50:00Z',
      reports: [rep('progress', '2026-09-23T14:10:30Z'), rep('completion', '2026-09-23T14:55:00Z')],
    })
    expect(t).toEqual({ startedAt: '2026-09-23T14:00:00Z', endedAt: '2026-09-23T14:55:00Z', minutes: 55, model: 'claude-opus-4-8', gaps: [10, 44], openMinutes: null })
  })

  it('작업 중이면 종료가 없고 지금까지 센다', () => {
    const t = orderTimeline({ status: 'claimed', claimed_at: '2026-09-23T14:00:00Z', reports: [] }, new Date('2026-09-23T15:30:59Z'))
    expect(t.endedAt).toBeNull()
    expect(t.minutes).toBe(90)
    expect(t.openMinutes).toBe(90)
  })

  it('재작업 claim 이 첫 보고보다 늦으면 첫 보고를 시작으로 본다', () => {
    const t = orderTimeline({
      status: 'claimed', claimed_at: '2026-09-23T16:00:00Z',
      reports: [rep('completion', '2026-09-23T15:00:00Z')],
    }, new Date('2026-09-23T16:30:00Z'))
    expect(t.startedAt).toBe('2026-09-23T15:00:00Z')
    expect(t.endedAt).toBeNull() // 반려 뒤 다시 작업 중 — 옛 completion 은 종료가 아니다
    expect(t.minutes).toBe(90)
    expect(t.openMinutes).toBe(90) // 마지막 보고(15:00)부터 지금(16:30)까지
  })

  it('heartbeat 가 비었으면 남은 모델 값을 믿지 않는다', () => {
    const t = orderTimeline({ status: 'claimed', claimed_at: null, heartbeat_model: 'haiku', last_heartbeat_at: null, reports: [] })
    expect(t).toMatchObject({ startedAt: null, minutes: null, model: null, gaps: [] })
  })
})
