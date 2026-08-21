// @vitest-environment jsdom
// 간트 날짜 축 여백: 축이 계획 최솟값~최댓값에서 뚝 끊겨 마지막 주에 마일스톤 라벨이
// 잘리고 "끊긴 느낌"이 든다(2026-08-21 피드백). 달력 주(월~일) 기준 이전 주 월요일부터
// 다음 주 일요일까지 보여준다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('간트 날짜 축 여백', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('계획 구간(수 07-01 ~ 금 07-10) 앞뒤로 이전 주 월요일(06-22)~다음 주 일요일(07-19)까지 4주가 나온다', async () => {
    // 완료 항목으로 고정 — 진행 0% 항목은 forecast(지연 전망)가 축 끝을 더 늘려 주 수가 달라진다.
    await act(async () => root.render(
      <WbsGanttSheet items={[item({ id: 'p1', depth: 0, actualPct: 100, rolledActualPct: 100, status: 'done' })]} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    // 여백 없으면 10일 = W01·W02 뿐. 06-22(월)~07-19(일) = 28일 = 정확히 W01~W04.
    expect(container.textContent).toContain('W04')
    expect(container.textContent).not.toContain('W05')
    // 축 시작이 월요일로 스냅됐다는 표식 — 첫 주 묶음의 부제가 6/22.
    expect(container.textContent).toContain('6/22')
  })
})
