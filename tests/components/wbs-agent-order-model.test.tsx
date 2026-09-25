// @vitest-environment jsdom
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
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'


/**
 * 진행 상황 표의 마지막 칸은 단계별 실행 모델이다(2026-09-25 사용자 요청, 0105) — 에이전트 칸을 대체했다.
 * 에이전트 이름은 title 로 남고, 모델을 모르는 옛 보고는 '—' 로 보인다.
 */
describe('WbsSpecPanel 진행 상황 — 단계별 모델 칸', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getAgentOrderForItem.mockReset()
    getAgentOrderForItem.mockResolvedValue({
      ok: true,
      order: {
        id: '22222222-2222-4222-8222-222222222222', status: 'claimed',
        claimed_by: 'agent-x', claimed_at: '2026-09-25T00:00:00Z', updated_at: '2026-09-25T02:00:00Z',
        heartbeat_model: 'haiku', last_heartbeat_at: '2026-09-25T02:00:00Z',
        reports: [
          { id: 'r1', kind: 'progress', percent: 20, summary: '설계', links: [], agent: 'agent-x', review_action: null, review_note: null, created_at: '2026-09-25T00:30:00Z', model: 'claude-opus-4-8' },
          { id: 'r2', kind: 'progress', percent: 60, summary: '구현', links: [], agent: 'agent-x', review_action: null, review_note: null, created_at: '2026-09-25T01:30:00Z', model: 'sonnet' },
          { id: 'r3', kind: 'progress', percent: 70, summary: '옛 보고', links: [], agent: 'agent-x', review_action: null, review_note: null, created_at: '2026-09-25T01:40:00Z' },
        ],
      },
      priorOrders: [],
      projectId: 'p1',
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('머리는 모델, 줄마다 그 단계 모델(claude- 접두 제거), 진행 중 줄은 지금 모델, 합계는 쓰인 모델 목록', async () => {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={false} />) })
    await act(async () => {})
    await act(async () => { container.querySelector<HTMLElement>('[data-spec-body-toggle]')!.click() })
    await act(async () => { container.querySelector<HTMLElement>('[data-agent-order-toggle]')!.click() })
    const heads = [...container.querySelectorAll('[data-agent-order-reports] thead th')].map(th => th.textContent)
    expect(heads.at(-1)).toBe('wbs.agentOrderModelCol')
    const cells = [...container.querySelectorAll<HTMLElement>('[data-agent-order-reports] tbody [data-report-model]')]
    expect(cells.map(c => c.textContent)).toEqual(['opus-4-8', 'sonnet', '—', 'haiku'])
    expect(cells[0].title).toBe('claude-opus-4-8 · agent-x')
    expect(container.querySelector('[data-agent-order-models]')?.textContent).toBe('opus-4-8 · sonnet · haiku')
  })
})
