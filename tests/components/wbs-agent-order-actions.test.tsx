// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getAgentOrderForItem = vi.fn()
const unapproveAgentCompletion = vi.fn()
const requestAgentRework = vi.fn()

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
  unapproveAgentCompletion: (...a: unknown[]) => unapproveAgentCompletion(...(a as [])),
  requestAgentRework: (...a: unknown[]) => requestAgentRework(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const ORDER_ID = '22222222-2222-4222-8222-222222222222'
function approvedOrder() {
  return {
    ok: true,
    order: {
      id: ORDER_ID, status: 'approved',
      claimed_by: 'agent-x', claimed_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-26T02:00:00Z',
      reports: [{
        id: 'r9', kind: 'completion', percent: 100, summary: '완료했습니다', links: [],
        agent: 'agent-x', review_action: 'approve', review_note: null, created_at: '2026-08-26T01:00:00Z',
      }],
    },
  }
}

/**
 * 승인된 주문을 사람이 무르는 두 버튼(2026-08-27). 승인 뒤엔 아무 버튼도 없어서
 * 잘못 누른 승인을 화면에서 되돌릴 방법이 없었다.
 */
describe('WbsSpecPanel 진행 상황 — 승인 되감기 버튼', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getAgentOrderForItem.mockReset(); unapproveAgentCompletion.mockReset(); requestAgentRework.mockReset()
    getAgentOrderForItem.mockResolvedValue(approvedOrder())
    unapproveAgentCompletion.mockResolvedValue({ ok: true })
    requestAgentRework.mockResolvedValue({ ok: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(editable: boolean) {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={editable} />) })
    await act(async () => {})
  }
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)

  it('관리자 — 승인된 주문에 승인 취소·재작업 요청 버튼이 있다', async () => {
    await render(true)
    expect(q('[data-agent-unapprove]')).not.toBeNull()
    expect(q('[data-agent-rework]')).not.toBeNull()
  })

  it('멤버 — 버튼이 나오지 않는다', async () => {
    await render(false)
    expect(q('[data-agent-unapprove]')).toBeNull()
    expect(q('[data-agent-rework]')).toBeNull()
  })

  it('승인 취소는 사유 없이 즉시 호출된다', async () => {
    await render(true)
    await act(async () => { q('[data-agent-unapprove]')!.click() })
    expect(unapproveAgentCompletion).toHaveBeenCalledWith(ORDER_ID)
  })

  it('재작업 요청은 사유를 받은 뒤 호출된다', async () => {
    await render(true)
    await act(async () => { q('[data-agent-rework]')!.click() })
    const input = q('[data-agent-rework-note]') as HTMLInputElement
    expect(input).not.toBeNull()
    // 사유가 비어 있는 동안은 확인 버튼이 잠긴다.
    expect((q('[data-agent-rework-confirm]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '테스트가 빠졌습니다')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { q('[data-agent-rework-confirm]')!.click() })
    expect(requestAgentRework).toHaveBeenCalledWith(ORDER_ID, '테스트가 빠졌습니다')
  })

  it('warning 은 실패가 아니라 잔여 안내 — 에러 배너(role=alert)로 띄우지 않는다', async () => {
    unapproveAgentCompletion.mockResolvedValue({
      ok: true, warning: '실적을 되돌리지 않았습니다 — 진척률을 직접 확인하세요.',
    })
    await render(true)
    await act(async () => { q('[data-agent-unapprove]')!.click() })
    const warn = q('[data-agent-warning]')
    expect(warn).not.toBeNull()
    expect(warn!.textContent).toContain('실적을 되돌리지 않았습니다')
    expect(warn!.getAttribute('role')).not.toBe('alert')
    expect(q('[role="alert"]')).toBeNull()
  })

  it('reported 상태에는 되감기 버튼이 없다 — 승인·반려가 이미 그 자리다', async () => {
    const o = approvedOrder()
    o.order.status = 'reported'
    getAgentOrderForItem.mockResolvedValue(o)
    await render(true)
    expect(q('[data-agent-unapprove]')).toBeNull()
    expect(q('[data-agent-rework]')).toBeNull()
  })
})
