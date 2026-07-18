import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RiskSignalReport } from '@/lib/domain/riskSignals'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: {
    href: string
    children: React.ReactNode
  }) => <a href={href} {...rest}>{children}</a>,
}))

import { RiskSignalCard, type MinuteAnchorSource } from '@/components/dashboard/RiskSignalCard'

/* ── 픽스처 — 엔진 산출 형태를 그대로 구성(카드는 재계산 없이 표시만 해야 한다) ── */
const cleanHygiene = { noOwner: 0, noDates: 0, mixedWeight: 0, clean: true }
const report = (over: Partial<RiskSignalReport> = {}): RiskSignalReport => ({
  signals: [], overall: 'green', hygiene: cleanHygiene, trendSparse: false,
  fingerprint: 'f', today: '2026-07-15', ...over,
})

describe('RiskSignalCard', () => {
  it('WBS evidence는 focus 딥링크, minute evidence는 minuteSourceHref 앵커로 렌더한다', () => {
    const anchors: MinuteAnchorSource[] = [
      { minuteId: 'm1', blockIndex: 4, blockHash: 'abcdef0123456789', bodyHash: '1111111111111111' },
    ]
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" minuteSignals={anchors} report={report({
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
    const html = renderToStaticMarkup(<RiskSignalCard projectId="p1" report={report()} />)
    expect(html).toContain('감지된 위험 신호 없음')
    expect(html).toContain('신호 0건')
    // 구조적 사각지대(회의 미연결 회의록)는 데이터 상태와 무관하게 항상 표기(D6 v1 수용)
    expect(html).toContain('미연결 회의록의 액션·기한은 포함되지 않습니다')
  })

  it('탐지 불능 조건(SPI 이력 부족·데이터 미비)은 무신호여도 캐비앗으로 표기한다', () => {
    const html = renderToStaticMarkup(
      <RiskSignalCard projectId="p1" report={report({
        trendSparse: true,
        hygiene: { noOwner: 2, noDates: 1, mixedWeight: 0, clean: false },
      })} />,
    )
    expect(html).toContain('지연 추세 신호는 아직 판정할 수 없습니다')
    expect(html).toContain('담당 미지정 2')
    expect(html).toContain('신호가 실제보다 적게 감지될 수 있습니다')
  })
})
