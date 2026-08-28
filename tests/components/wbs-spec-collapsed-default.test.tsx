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

function order(status: string) {
  return {
    ok: true,
    order: {
      id: '22222222-2222-4222-8222-222222222222', status,
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
    getAgentOrderForItem.mockResolvedValue(order('approved'))
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

  // 승인·반려는 사람만 할 수 있고 이 화면이 유일한 자리다 — 명세 접힘 안쪽에 두면
  // 승인 대기 주문이 두 겹 접힘 뒤로 사라진다.
  it('진행 상황은 명세 본문 밖이다 — 명세가 접혀 있어도 보인다', async () => {
    await render()
    expect(specToggle().getAttribute('aria-expanded')).toBe('false')
    expect(orderToggle()).not.toBeNull()
    expect(container.textContent).toContain('wbs.agentOrderApproved') // 상태 칩은 접혀도 보인다
  })

  it('진행 상황도 접힌 채로 시작한다 — 보고 내용이 바로 쏟아지지 않는다', async () => {
    await render()
    expect(orderToggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('완료했습니다')
  })

  it('토글을 누르면 보고가 보인다', async () => {
    await render()
    await act(async () => { orderToggle()!.click() })
    expect(container.textContent).toContain('완료했습니다')
  })

  it('승인 대기(reported)면 스스로 펼친다 — 사람이 해야 할 일이 남아 있다', async () => {
    getAgentOrderForItem.mockResolvedValue(order('reported'))
    await render()
    expect(orderToggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('wbs.agentOrderApprove') // 승인 버튼이 바로 보인다
  })
})
