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
    acceptance: [], spec: '명세 본문', externalRef: 'mod/TSK-01-01', agentPrompt: null,
  }),
  setAgentDelegation: vi.fn(), updateAgentPrompt: vi.fn(),
  updateWbsSpec: vi.fn(), updateWbsSpecFields: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: (...a: unknown[]) => getAgentOrderForItem(...(a as [])),
  approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(), requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

function reportedOrder() {
  return {
    ok: true,
    order: {
      id: '22222222-2222-4222-8222-222222222222', status: 'reported',
      claimed_by: 'agent-x', claimed_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-26T02:00:00Z',
      reports: [{
        id: 'r9', kind: 'completion', percent: 100, summary: '완료했습니다', links: [],
        agent: 'agent-x', review_action: null, review_note: null, created_at: '2026-08-26T01:00:00Z',
      }],
    },
  }
}

describe('명세·진행 상황은 기본으로 접혀 있다', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getAgentOrderForItem.mockReset()
    getAgentOrderForItem.mockResolvedValue(reportedOrder())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render() {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable /> ) })
    await act(async () => {})
  }
  const specToggle = () => container.querySelector<HTMLElement>('[data-spec-body-toggle]')!
  const orderToggle = () => container.querySelector<HTMLElement>('[data-agent-order-toggle]')

  it('명세 본문은 접힌 채로 시작한다 — 제목만 남는다', async () => {
    await render()
    expect(specToggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('명세 본문')
  })

  it('명세를 펼쳐도 진행 상황은 접혀 있다 — 보고 내용이 바로 쏟아지지 않는다', async () => {
    await render()
    await act(async () => { specToggle().click() })
    expect(orderToggle()).not.toBeNull()
    expect(orderToggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('완료했습니다')
  })

  it('접혀 있어도 주문 상태 칩은 보인다 — 승인 대기를 놓치면 안 된다', async () => {
    await render()
    await act(async () => { specToggle().click() })
    expect(container.textContent).toContain('wbs.agentOrderReported')
  })

  it('진행 상황 토글을 누르면 보고가 보인다', async () => {
    await render()
    await act(async () => { specToggle().click() })
    await act(async () => { orderToggle()!.click() })
    expect(container.textContent).toContain('완료했습니다')
  })
})
