import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RiskSignalReport } from '@/lib/domain/riskSignals'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: {
    href: string
    children: React.ReactNode
  }) => <a href={href} {...rest}>{children}</a>,
}))
// 클라이언트 섹션이 참조하는 서버 액션은 SSR 렌더에서 호출되지 않는다 — 모듈 로드만 차단(verify 스킬 관례)
vi.mock('@/app/actions/brief', () => ({ ensureProjectBriefAction: vi.fn() }))
vi.mock('@/app/actions/risk', () => ({ ensureRiskBriefAction: vi.fn() }))

import { RiskSignalCard, type MinuteAnchorSource } from '@/components/dashboard/RiskSignalCard'

/* ── 픽스처 — 엔진 산출 형태를 그대로 구성(카드는 재계산 없이 표시만 해야 한다) ── */
const cleanHygiene = { noOwner: 0, noDates: 0, mixedWeight: 0, clean: true }
const report = (over: Partial<RiskSignalReport> = {}): RiskSignalReport => ({
  signals: [], overall: 'green', hygiene: cleanHygiene, trendSparse: false,
  fingerprint: 'f', today: '2026-07-15', ...over,
})
/** 통합 카드(D1) 필수 props — 브리핑 층 기본값. */
const briefProps = {
  kpiLine: '전체 실적 40.5% · 계획 50.0% · 편차 -9.5%p',
  baseDate: '2026-07-15',
  realToday: '2026-07-19',
}

describe('RiskSignalCard', () => {
  it('WBS evidence는 focus 딥링크, minute evidence는 minuteSourceHref 앵커로 렌더한다', () => {
    const anchors: MinuteAnchorSource[] = [
      { minuteId: 'm1', blockIndex: 4, blockHash: 'abcdef0123456789', bodyHash: '1111111111111111' },
    ]
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} minuteSignals={anchors} report={report({
        overall: 'red',
        signals: [
          {
            id: 'deadline_stall', kind: 'deadline_stall', severity: 'red',
            title: '마감 임박 작업 진척 정체', detail: '7일 내 마감 1건이 계획 대비 뒤처져 있습니다(최대 12%p 갭).',
            metrics: { count: 1, maxGapPp: 12.3, nearestEnd: '2026-07-18' },
            evidence: [{ type: 'wbs_item', itemId: 'a1', label: '설계검토' }],
          },
          {
            id: 'meeting_action_stale', kind: 'meeting_action_stale', severity: 'amber',
            title: '회의 액션 기한 경과', detail: '회의에서 나온 액션·기한 항목 1건이 7일 이상 경과했습니다 — 이행 여부 확인이 필요합니다.',
            metrics: { count: 1, oldestDate: '2026-07-01', oldestDays: 14 },
            evidence: [
              { type: 'minute_block', minuteId: 'm1', blockIndex: 4, blockHash: 'abcdef0123456789', label: '견적 회신' },
              // 앵커 소스 밖 참조 — bodyHash를 못 찾으면 회의록 문서로 폴백(링크를 숨기지 않는다)
              { type: 'minute_block', minuteId: 'm2', blockIndex: 0, blockHash: '0000000000000000', label: '일정 재협의' },
            ],
          },
        ],
      })} />,
    )

    expect(html).toContain('href="/p/p1/wbs?focus=a1"')
    expect(html).toContain('href="/minutes/m1?block=4&amp;hash=abcdef0123456789&amp;body=1111111111111111"')
    expect(html).toContain('href="/minutes/m2"')
    expect(html).toContain('신호 2건')
    // 색맹 대응 텍스트 라벨 — 도트 색만으로 심각도를 전달하지 않는다
    expect(html).toContain('심각')
    expect(html).toContain('주의')
  })

  it('신호 0건이면 정직한 무신호 문구를 렌더한다(빈 카드 숨김 금지)', () => {
    const html = renderToStaticMarkup(<RiskSignalCard projectId="p1" {...briefProps} report={report()} />)
    expect(html).toContain('감지된 위험 신호 없음')
    expect(html).toContain('신호 0건')
    // 구조적 사각지대(회의 미연결 회의록)는 데이터 상태와 무관하게 항상 표기(D6 v1 수용)
    expect(html).toContain('미연결 회의록의 액션·기한은 포함되지 않습니다')
  })

  it('탐지 불능 조건(SPI 이력 부족·데이터 미비)은 무신호여도 캐비앗으로 표기한다', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} report={report({
        trendSparse: true,
        hygiene: { noOwner: 2, noDates: 1, mixedWeight: 0, clean: false },
      })} />,
    )
    expect(html).toContain('지연 추세 신호는 아직 판정할 수 없습니다')
    expect(html).toContain('담당 미지정 2')
    expect(html).toContain('신호가 실제보다 적게 감지될 수 있습니다')
  })

  /* ── D1 통합 층 — 브리핑·해설 ── */

  it('결정형 kpiLine 은 브리핑 유무와 무관하게 항상 렌더된다', () => {
    const html = renderToStaticMarkup(<RiskSignalCard projectId="p1" {...briefProps} report={report()} />)
    expect(html).toContain('전체 실적 40.5% · 계획 50.0% · 편차 -9.5%p')
    expect(html).toContain('AI 브리핑 생성') // 캐시 없음 → 생성 버튼
  })

  it('주간 브리핑 캐시가 있으면 헤드라인·본문을 순수 텍스트로 렌더한다(HTML 미해석)', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} report={report()} weeklyBrief={{
        headline: '이번 주는 지연 관리가 관건',
        bodyMd: '## 진행 현황\n- 실적 40.5% 수준 <b>주의</b>',
        updatedAt: '2026-07-19T02:00:00Z', model: 'gemini-3.5-flash', fresh: true,
      }} />,
    )
    expect(html).toContain('이번 주는 지연 관리가 관건')
    expect(html).toContain('진행 현황')
    expect(html).toContain('&lt;b&gt;주의&lt;/b&gt;') // 순수 텍스트 렌더 — 태그 이스케이프(인젝션 차단)
    expect(html).toContain('다시 생성')
  })

  it('stale 브리핑에는 기준 데이터 변경 칩을 표기한다', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} report={report()} weeklyBrief={{
        headline: 'h', bodyMd: 'b', updatedAt: '2026-07-19T02:00:00Z', model: '', fresh: false,
      }} />,
    )
    expect(html).toContain('기준 데이터 변경됨')
  })

  it('신선한 위험 해설은 신호 제목과 함께 우선순위 순으로 렌더된다', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} report={report({
        overall: 'amber',
        signals: [{
          id: 'overdue_accumulation', kind: 'overdue_accumulation', severity: 'amber',
          title: '예정일 경과 작업 누적', detail: '기한이 지난 미완료 작업이 2건 쌓여 있습니다(15일 이상 경과 0건).',
          metrics: { total: 2 }, evidence: [],
        }],
      })} riskBrief={{
        headline: '지연 누적부터 정리 필요',
        items: [{ signalId: 'overdue_accumulation', priority: 1, comment: '누적 지연이 후속 일정을 압박합니다.', action: '담당 팀과 만회 일정을 합의하세요.' }],
        fresh: true, status: 'ready',
      }} />,
    )
    expect(html).toContain('AI 해설')
    expect(html).toContain('지연 누적부터 정리 필요')
    expect(html).toContain('1. 예정일 경과 작업 누적')
    expect(html).toContain('→ 담당 팀과 만회 일정을 합의하세요.')
  })

  it('신호 0건이면 AI 해설 섹션 자체를 렌더하지 않는다(해설 대상 없음)', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" {...briefProps} report={report()} riskBrief={null} />,
    )
    // 헤더 칩('규칙 기반 탐지 + AI 해설')과 구분되는 섹션 고유 마커로 판정
    expect(html).not.toContain('신호가 바뀔 때만 재생성')
  })
})
