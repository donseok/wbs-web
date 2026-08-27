// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpec = vi.fn()
const updateWbsSpecFields = vi.fn()
const updateAgentPrompt = vi.fn()
const setAgentDelegation = vi.fn()

vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  updateWbsSpecFields: (...a: unknown[]) => updateWbsSpecFields(...(a as [])),
  updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])),
  setAgentDelegation: (...a: unknown[]) => setAgentDelegation(...(a as [])),
  updateWbsSpec: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: vi.fn().mockResolvedValue({ ok: true, order: null }),
  approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(), requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const DETAIL = {
  category: 'dev', domain: null, priority: 'high', model: null,
  tags: ['agent'], depends: [], prdRef: null, entryPoint: null,
  acceptance: [], spec: null, externalRef: 'mod/TSK-01-01', agentPrompt: null,
}

/**
 * 명세 섹션은 읽기 상태에서도 select·체크박스·textarea 가 늘 펼쳐져 있어 패널 높이의
 * 대부분을 먹었다(2026-08-28). 편집 위젯은 토글 뒤로 보낸다 — 단, 참조·프롬프트가
 * blur 커밋이라 토글을 닫을 때 명시적으로 커밋하지 않으면 입력이 조용히 사라진다.
 */
describe('WbsSpecPanel 편집 토글', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getWbsSpec.mockReset(); updateWbsSpecFields.mockReset(); updateAgentPrompt.mockReset()
    getWbsSpec.mockResolvedValue(DETAIL)
    updateWbsSpecFields.mockResolvedValue({ ok: true })
    updateAgentPrompt.mockResolvedValue({ ok: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(editable = true) {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={editable} />) })
    await act(async () => {})
  }
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)
  const toggle = () => q('[data-spec-edit-toggle]')
  async function type(el: HTMLElement, value: string) {
    await act(async () => {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('기본은 읽기 — 편집 위젯이 하나도 없다', async () => {
    await render()
    expect(toggle()).not.toBeNull()
    expect(q('[data-spec-prd-ref]')).toBeNull()
    expect(q('[data-spec-priority]')).toBeNull()
    expect(q('[data-agent-prompt]')).toBeNull()
    expect(q('[data-spec-delegate]')).toBeNull()
  })

  it('토글을 켜면 편집 위젯이 나타난다', async () => {
    await render()
    await act(async () => { toggle()!.click() })
    expect(q('[data-spec-prd-ref]')).not.toBeNull()
    expect(q('[data-spec-priority]')).not.toBeNull()
    expect(q('[data-agent-prompt]')).not.toBeNull()
    expect(q('[data-spec-delegate]')).not.toBeNull()
  })

  it('토글을 닫으면 입력 중이던 프롬프트가 커밋된다 — blur 를 기다리지 않는다', async () => {
    await render()
    await act(async () => { toggle()!.click() })
    await type(q('[data-agent-prompt]')!, '이 계약을 지켜라')
    await act(async () => { toggle()!.click() })
    expect(updateAgentPrompt).toHaveBeenCalledWith('item-1', '이 계약을 지켜라')
    expect(q('[data-agent-prompt]')).toBeNull()
  })

  it('토글을 닫으면 입력 중이던 참조도 커밋된다', async () => {
    await render()
    await act(async () => { toggle()!.click() })
    await type(q('[data-spec-prd-ref]')!, 'docs/prd.md#3')
    await act(async () => { toggle()!.click() })
    expect(updateWbsSpecFields).toHaveBeenCalledWith('item-1', { prd_ref: 'docs/prd.md#3' })
  })

  it('바뀐 게 없으면 닫아도 쓰지 않는다', async () => {
    await render()
    await act(async () => { toggle()!.click() })
    await act(async () => { toggle()!.click() })
    expect(updateWbsSpecFields).not.toHaveBeenCalled()
    expect(updateAgentPrompt).not.toHaveBeenCalled()
  })

  it('멤버(editable=false)에게는 토글이 없다', async () => {
    await render(false)
    expect(toggle()).toBeNull()
    expect(q('[data-agent-prompt]')).toBeNull()
  })
})
