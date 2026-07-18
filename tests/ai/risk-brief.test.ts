import { describe, it, expect } from 'vitest'
import type { RiskSignalReport } from '@/lib/domain/riskSignals'
import { parseRiskBrief } from '@/lib/ai/risk-brief'

const report = (ids: string[]): RiskSignalReport => ({
  signals: ids.map(id => ({
    id, kind: 'overdue_accumulation', severity: 'amber', title: `신호 ${id}`, detail: '', metrics: {}, evidence: [],
  })),
  overall: 'amber',
  hygiene: { noOwner: 0, noDates: 0, mixedWeight: 0, clean: true },
  trendSparse: false,
  fingerprint: 'fp',
  today: '2026-07-15',
})

describe('parseRiskBrief', () => {
  it('서두/후미 텍스트 속 JSON 을 관용 파싱하고 priority 순 정렬한다', () => {
    const raw = '알겠습니다.\n{"headline":"지연 누적이 최우선","items":[' +
      '{"signalId":"b","priority":2,"comment":"둘째","action":"조치B"},' +
      '{"signalId":"a","priority":1,"comment":"첫째","action":"조치A"}]}\n이상입니다.'
    const p = parseRiskBrief(raw, report(['a', 'b']))!
    expect(p.headline).toBe('지연 누적이 최우선')
    expect(p.items.map(i => i.signalId)).toEqual(['a', 'b'])
  })

  it('리포트에 없는 signalId 는 폐기(환각 차단), 중복은 첫 항목만', () => {
    const raw = '{"headline":"h","items":[' +
      '{"signalId":"ghost","priority":1,"comment":"환각","action":""},' +
      '{"signalId":"a","priority":1,"comment":"진짜","action":""},' +
      '{"signalId":"a","priority":2,"comment":"중복","action":""}]}'
    const p = parseRiskBrief(raw, report(['a']))!
    expect(p.items).toHaveLength(1)
    expect(p.items[0].comment).toBe('진짜')
  })

  it('comment/action 200자 캡 + priority 비수치는 순번 폴백', () => {
    const long = '가'.repeat(500)
    const raw = `{"headline":"h","items":[{"signalId":"a","priority":"높음","comment":"${long}","action":"${long}"}]}`
    const p = parseRiskBrief(raw, report(['a']))!
    expect(p.items[0].comment).toHaveLength(200)
    expect(p.items[0].action).toHaveLength(200)
    expect(p.items[0].priority).toBe(1)
  })

  it('유효 항목 0건·불량 JSON → null(행 미기록 신호)', () => {
    expect(parseRiskBrief('{"headline":"h","items":[]}', report(['a']))).toBeNull()
    expect(parseRiskBrief('{"headline":"h","items":[{"signalId":"ghost"}]}', report(['a']))).toBeNull()
    expect(parseRiskBrief('JSON 아님', report(['a']))).toBeNull()
    expect(parseRiskBrief('{broken', report(['a']))).toBeNull()
  })

  it('헤드라인 120자 캡, 누락 시 빈 문자열', () => {
    const raw = `{"headline":"${'가'.repeat(300)}","items":[{"signalId":"a","priority":1,"comment":"c","action":"x"}]}`
    expect(parseRiskBrief(raw, report(['a']))!.headline).toHaveLength(120)
    const noHead = '{"items":[{"signalId":"a","priority":1,"comment":"c","action":"x"}]}'
    expect(parseRiskBrief(noHead, report(['a']))!.headline).toBe('')
  })
})
