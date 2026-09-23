// @vitest-environment jsdom
// Task 사이드바 보고 이력의 결정 목록(과제 C, 스펙 §7.2) — 승인 대기 회차는 펼치고, 옛 회차는 접는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getAgentOrderForItem = vi.fn()
vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: vi.fn().mockResolvedValue({
    category: null, domain: null, priority: null, model: null,
    tags: ['agent'], depends: [], prdRef: null, entryPoint: null,
    acceptance: [], spec: null, externalRef: 'mod/TSK-01-01', agentPrompt: null,
  }),
  setAgentDelegation: vi.fn(),
  updateAgentPrompt: vi.fn(),
  updateWbsSpec: vi.fn(),
  updateWbsSpecFields: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: (...a: unknown[]) => getAgentOrderForItem(...(a as [])),
  approveAgentCompletion: vi.fn(),
  rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(),
  requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const DEC = (key: string) => ({ key, question: `${key} 질문`, options: ['가', '나'], chosen: 1, rationale: '근거', on_reject: '방향' })
const rep = (id: string, kind: 'progress' | 'completion', created_at: string, decisions: unknown, review_action: 'reject' | null = null) => ({
  id, kind, percent: kind === 'completion' ? 100 : 40, summary: `${id} 요약`, links: [], agent: 'hong/mbp/w1',
  review_action, review_note: review_action ? 'D2 는 선택지 2로' : null, created_at, decisions,
})
function reportedOrder(reports: unknown[]) {
  return {
    ok: true,
    order: { id: '22222222-2222-4222-8222-222222222222', status: 'reported', claimed_by: 'hong/mbp/w1', claimed_at: null, updated_at: '2026-09-23T03:00:00Z', reports },
    priorOrders: [], projectId: 'p1',
  }
}

describe('WbsSpecPanel 진행 상황 — 결정 목록', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    getAgentOrderForItem.mockReset()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  // 진행 상황은 명세 본문 밖에 있고, reported 면 스스로 펼쳐진다 — 토글을 누르지 않는다(누르면 닫힌다).
  async function render() {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable />) })
    await act(async () => {})
  }

  it('승인 대기 회차(마지막 completion)는 펼치고, 반려된 옛 회차는 결정 수만 보이게 접는다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', [DEC('D1'), DEC('D2'), DEC('D3')], 'reject'),
      rep('r2', 'progress', '2026-09-23T02:00:00Z', null),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', [DEC('D1')]),
    ]))
    await render()
    const folds = container.querySelectorAll('details[data-report-decisions-fold]')
    expect(folds).toHaveLength(1)
    expect(folds[0].querySelector('summary')!.textContent).toBe('결정 3건')
    const open = [...container.querySelectorAll('[data-decisions="ok"]')].filter(e => !e.closest('details'))
    expect(open).toHaveLength(1)
    expect(open[0].querySelectorAll('[data-decision]')).toHaveLength(1)
  })
  it('progress 보고에는 결정 영역이 없다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([rep('r2', 'progress', '2026-09-23T02:00:00Z', null)]))
    await render()
    expect(container.querySelector('[data-decisions]')).toBeNull()
    expect(container.querySelector('details[data-report-decisions-fold]')).toBeNull()
  })
  it('구 CLI 보고(null) 미제출 문구는 가장 최근 completion 회차에만 — 옛 회차는 생략(0102 이전 회차 잡음 방지)', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', null, 'reject'),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', null),
    ]))
    await render()
    expect(container.querySelector('details[data-report-decisions-fold]')).toBeNull()
    expect(container.querySelectorAll('[data-decisions="none"]')).toHaveLength(1)
  })
  it('재작업 중(claimed)이면 최신 completion 의 미제출은 접힌 머리로, 그보다 옛 회차는 생략', async () => {
    const o = reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', null, 'reject'),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', null, 'reject'),
    ])
    getAgentOrderForItem.mockResolvedValue({ ...o, order: { ...o.order, status: 'claimed' } })
    await render()
    // reported 가 아니면 진행 상황이 접혀 있다 — 토글로 연다.
    await act(async () => { (container.querySelector('[data-agent-order-toggle]') as HTMLButtonElement).click() })
    const folds = container.querySelectorAll('details[data-report-decisions-fold]')
    expect(folds).toHaveLength(1)
    expect(folds[0].querySelector('summary')!.textContent).toBe('결정 목록 미제출')
  })
  it('옛 회차가 0건([])이면 접힌 영역도 그리지 않는다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', [], 'reject'),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', [DEC('D1')]),
    ]))
    await render()
    expect(container.querySelector('details[data-report-decisions-fold]')).toBeNull()
  })
})
