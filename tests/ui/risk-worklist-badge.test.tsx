// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

import { RiskWorklist } from '@/components/dashboard/RiskWorklist'
import { riskModel } from '@/lib/domain/dashboard'

const today = '2026-07-14'
const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], ...over,
})

// 실행 큐 배지는 리스크 타일(riskModel)과 같은 숫자를 말해야 한다.
// 기한 경과분이 0인 프로젝트에서 '지연 0 · 임박 100'처럼 딴 숫자가 나오던 회귀를 잡는다.
describe("RiskWorklist '지연 · 임박' 배지", () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const items = [
    leaf({ status: 'delayed', plannedEnd: '2026-07-30', plannedPct: 50, rolledActualPct: 10 }), // 지연(마감 전)
    leaf({ status: 'in_progress', plannedEnd: '2026-07-16' }),                                   // 임박(D+2)
    leaf({ status: 'in_progress', plannedEnd: '2026-09-01' }),                                   // 먼 미래 — 어느 쪽도 아님
    leaf({ status: 'done', plannedEnd: '2026-07-15' }),                                          // 완료 제외
  ]

  it('배지 숫자가 riskModel(리스크 타일)과 일치한다', async () => {
    const risk = riskModel(items, today)
    expect([risk.delayed, risk.dueSoon]).toEqual([1, 1]) // 픽스처 확인

    await act(async () => root.render(<RiskWorklist items={items} projectId="p1" today={today} />))
    expect(container.textContent).toContain(`지연 ${risk.delayed} · 임박 ${risk.dueSoon}`)
  })

  it('마감이 남은 작업 전체를 임박으로 세지 않는다', async () => {
    await act(async () => root.render(<RiskWorklist items={items} projectId="p1" today={today} />))
    expect(container.textContent).not.toContain('임박 3')
  })
})
