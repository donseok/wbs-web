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

import { compactCount, parseTokenUsage, sumTokenUsage } from '@/lib/domain/agentWork'

describe('사용 토큰(0104) — 합산·표기·검증', () => {
  const row = (model: string, i: number, o: number, cw: number, cr: number) =>
    ({ model, input_tokens: i, output_tokens: o, cache_creation_tokens: cw, cache_read_tokens: cr })

  it('세션이 달라도 같은 모델은 합치고, 합계가 큰 모델부터 둔다', () => {
    const s = sumTokenUsage([row('haiku', 1, 10, 0, 100), row('opus', 2, 20, 300, 4000), row('opus', 3, 30, 0, 5000)])!
    expect(s.total).toEqual({ input: 6, output: 60, cache_creation: 300, cache_read: 9100 })
    expect(s.byModel.map(m => m.model)).toEqual(['opus', 'haiku'])
    expect(s.byModel[0]).toMatchObject({ input: 5, output: 50, cache_creation: 300, cache_read: 9000 })
  })

  it('PostgREST 가 bigint 를 문자열로 줘도 숫자로 더한다', () => {
    const s = sumTokenUsage([{ model: 'opus', input_tokens: '7', output_tokens: '8', cache_creation_tokens: '0', cache_read_tokens: '9' } as never])!
    expect(s.total).toEqual({ input: 7, output: 8, cache_creation: 0, cache_read: 9 })
  })

  it('행이 없으면 null', () => expect(sumTokenUsage([])).toBeNull())

  it.each([[999, '999'], [1234, '1.2k'], [45_678, '46k'], [1_234_567, '1.2M'], [218_856_948, '219M'], [2_500_000_000, '2.5B']])(
    'compactCount(%d) = %s', (n, s) => expect(compactCount(n)).toBe(s))

  it('tokens 가 없으면 null, 있으면 모델별로 정규화한다', () => {
    expect(parseTokenUsage(undefined)).toEqual({ ok: true, value: null })
    expect(parseTokenUsage({ session: 'abc-1', models: [{ model: 'claude-opus-4-8', input: 1, output: 2, cache_creation: 3, cache_read: 4 }] }))
      .toEqual({ ok: true, value: { session: 'abc-1', models: [{ model: 'claude-opus-4-8', input: 1, output: 2, cache_creation: 3, cache_read: 4 }] } })
    expect(parseTokenUsage({ session: 'abc-1', models: Array.from({ length: 21 }, (_, i) => ({ model: `m${i}`, input: 0, output: 0, cache_creation: 0, cache_read: 0 })) }).ok).toBe(false)
  })
})
