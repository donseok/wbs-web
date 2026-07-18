import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import {
  buildBriefFacts, briefFactsHash, factsToPrompt, parseBrief, verifyBriefNumbers,
  type BriefFactsInput,
} from '@/lib/ai/brief'

/* ── 픽스처 — riskSignals.test 의 leaf 관례 재사용 ── */
let seq = 0
const leaf = (over: Partial<ComputedItem> = {}): ComputedItem => ({
  id: `L${seq++}`, parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], plannedPct: 0, rolledActualPct: 0,
  achievement: null, status: 'in_progress', children: [], ...over,
})
const TODAY = '2026-07-15'
const input = (over: Partial<BriefFactsInput> = {}): BriefFactsInput => ({
  projectName: '테스트 프로젝트', items: [], startDate: '2026-01-01', endDate: '2026-12-31',
  todayWbs: TODAY, realToday: '2026-07-19', holidays: [], snapshots: [],
  minuteSignals: [], meetings: [], meetingExceptions: [], ...over,
})

describe('buildBriefFacts', () => {
  it('kpiLine 은 결정형 소수 1자리 포맷(formatPct1/formatPp1)으로 조립된다', () => {
    const items = [leaf({ plannedPct: 50, rolledActualPct: 40.5 })]
    const f = buildBriefFacts(input({ items }))
    expect(f.kpiLine).toBe('전체 실적 40.5% · 계획 50.0% · 편차 -9.5%p')
  })

  it('리스크 팩트는 RiskSignalReport 소비(C3) — 자체 지연 목록을 재조립하지 않는다', () => {
    const items = [leaf({ name: '지연작업', plannedEnd: '2026-07-01', plannedPct: 80, rolledActualPct: 10, status: 'delayed' })]
    const f = buildBriefFacts(input({ items }))
    const overdue = f.riskReport.signals.find(s => s.kind === 'overdue_accumulation')
    expect(overdue).toBeDefined()
    expect(f.riskReport.hygiene).toBeDefined() // hygiene 도 리포트 경유(중복 계산 금지)
  })

  it('이중 시계: 진척은 todayWbs, 회의록 노트 날짜는 원본 유지', () => {
    const f = buildBriefFacts(input({
      minuteSignals: [{
        id: 'i1', minuteId: 'm1', bodyHash: 'h', kind: 'action', label: '견적 회신',
        blockIndex: 0, blockHash: 'b', minuteTitle: '주간회의', minuteDate: '2026-07-10',
      }],
    }))
    expect(f.todayWbs).toBe(TODAY)
    expect(f.todayReal).toBe('2026-07-19')
    expect(f.minuteNotes[0]).toMatchObject({ label: '견적 회신', date: '2026-07-10' })
  })

  it("kind='none' 인사이트는 노트에서 제외", () => {
    const f = buildBriefFacts(input({
      minuteSignals: [{
        id: 'i1', minuteId: 'm1', bodyHash: 'h', kind: 'none', label: '',
        blockIndex: -1, blockHash: '', minuteTitle: '주간회의', minuteDate: '2026-07-10',
      }],
    }))
    expect(f.minuteNotes).toEqual([])
    expect(f.minuteNotesTotal).toBe(0)
  })
})

describe('factsToPrompt', () => {
  it('이원화 기준일·KPI·위험 신호가 [데이터] 블록에 들어간다', () => {
    const items = [leaf({ name: '지연작업', plannedEnd: '2026-07-01', plannedPct: 80, rolledActualPct: 10, status: 'delayed' })]
    const p = factsToPrompt(buildBriefFacts(input({ items })))
    expect(p).toContain('[데이터]')
    expect(p).toContain(`진척·리스크 = ${TODAY}`)
    expect(p).toContain('회의·회의록 = 2026-07-19')
    expect(p).toContain('예정일 경과 작업 누적')
  })

  it('마감 임박 목록은 10건 캡 + «외 N건» 병기', () => {
    const items = Array.from({ length: 13 }, (_, i) =>
      leaf({ name: `마감작업${i}`, plannedEnd: '2026-07-18', plannedPct: 10, rolledActualPct: 10 }))
    const f = buildBriefFacts(input({ items }))
    expect(f.dueSoonTop).toHaveLength(10)
    expect(f.dueSoonTotal).toBe(13)
    expect(factsToPrompt(f)).toContain('외 3건')
  })

  it('총량 캡 6000자를 넘지 않는다', () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      leaf({ name: `아주 긴 이름의 작업 항목 ${'가나다라마바사'.repeat(10)}${i}`, plannedEnd: '2026-07-18' }))
    expect(factsToPrompt(buildBriefFacts(input({ items }))).length).toBeLessThanOrEqual(6000)
  })
})

describe('briefFactsHash', () => {
  it('동일 입력 = 동일 해시, 팩트에 반영되는 변경(실적) = 다른 해시', () => {
    const a = buildBriefFacts(input({ items: [leaf({ id: 'a', name: '작업A', rolledActualPct: 10 })] }))
    const b = buildBriefFacts(input({ items: [leaf({ id: 'a', name: '작업A', rolledActualPct: 10 })] }))
    const c = buildBriefFacts(input({ items: [leaf({ id: 'a', name: '작업A', rolledActualPct: 20 })] }))
    expect(briefFactsHash(a)).toBe(briefFactsHash(b))
    expect(briefFactsHash(a)).not.toBe(briefFactsHash(c))
  })

  it('팩트에 등장하지 않는 변경(어느 목록에도 없는 항목의 이름)은 해시 불변 — 서술 근거가 같다', () => {
    const a = buildBriefFacts(input({ items: [leaf({ id: 'a', name: '작업A' })] }))
    const c = buildBriefFacts(input({ items: [leaf({ id: 'a', name: '작업B' })] }))
    expect(briefFactsHash(a)).toBe(briefFactsHash(c))
  })
})

describe('parseBrief', () => {
  it('코드펜스 제거 + 첫 줄 헤드라인(마크다운 접두 제거) + 본문 분리', () => {
    const raw = '```markdown\n## 이번 주는 순항 중\n\n## 진행 현황\n- 전체 실적 40.5%\n```'
    const p = parseBrief(raw)!
    expect(p.headline).toBe('이번 주는 순항 중')
    expect(p.bodyMd).toContain('## 진행 현황')
  })
  it('빈 응답 → null', () => {
    expect(parseBrief('')).toBeNull()
    expect(parseBrief('```\n\n```')).toBeNull()
  })
  it('헤드라인 120자 캡', () => {
    expect(parseBrief('가'.repeat(300))!.headline).toHaveLength(120)
  })
})

describe('verifyBriefNumbers', () => {
  const facts = () => buildBriefFacts(input({
    items: [leaf({ plannedPct: 50, rolledActualPct: 40.5 })],
  }))

  it('팩트에 있는 수치(%·%p·건)는 통과한다 — 정수 반올림 표기 포함', () => {
    const { text, removed } = verifyBriefNumbers(
      '- 전체 실적 40.5%로 계획 50% 대비 -9.5%p 뒤처짐\n- 실적은 약 41% 수준', facts())
    expect(removed).toEqual([])
    expect(text).toContain('40.5%')
    expect(text).toContain('41%') // Math.round(40.5)=41 — 봇 정수 관례 허용
  })

  it('팩트에 없는 수치가 든 줄은 제거되고 removed 로 보고된다', () => {
    const { text, removed } = verifyBriefNumbers(
      '- 전체 실적 40.5%\n- 리스크 항목이 77건 누적되었습니다', facts())
    expect(text).not.toContain('77건')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('77건')
  })

  it('×100 확대 환각(50→5000건·40.5→4050건)은 통과하지 못한다 — ×100 은 소수 비율 전용', () => {
    const { removed } = verifyBriefNumbers(
      '- 리스크 항목이 5000건 누적되었습니다\n- 이슈 4050건 발생\n- 지연이 950건입니다', facts())
    expect(removed).toHaveLength(3)
  })

  it('날짜 조각(YYYY-MM-DD 의 15·2026 등)은 허용 수로 오염되지 않는다', () => {
    // todayWbs=2026-07-15 지만 날짜는 화이트리스트 추출 전에 제거된다
    const { removed } = verifyBriefNumbers(
      '- 지연 작업이 15건입니다\n- 이슈 2026건 발생', facts())
    expect(removed).toHaveLength(2)
  })

  it('SPI 소수 비율은 % 표기(0.85→85%)로 인용해도 통과한다', () => {
    const withSpi = buildBriefFacts(input({
      items: [leaf({ plannedPct: 50, rolledActualPct: 40.5 })],
      snapshots: [{ date: '2026-07-10', actual: 34, planned: 40 }], // SPI 0.85
    }))
    const { removed } = verifyBriefNumbers('- SPI가 85% 수준까지 내려왔습니다', withSpi)
    expect(removed).toEqual([])
  })

  it('날짜·D-day 는 단위(%·건) 토큰이 아니므로 검사하지 않는다(오탐 방지)', () => {
    const { removed } = verifyBriefNumbers(
      '- 2026-07-18 마감 예정, D-3 시점입니다', facts())
    expect(removed).toEqual([])
  })
})
