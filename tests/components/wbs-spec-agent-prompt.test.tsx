// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpec = vi.fn()
const updateAgentPrompt = vi.fn()
const refresh = vi.fn()

vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])),
  setAgentDelegation: vi.fn(),
  updateWbsSpec: vi.fn(),
  updateWbsSpecFields: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
// MarkdownView 동적 import 체인(minutes) 차단 — 이 테스트 관심사 아님.
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const DETAIL = {
  category: null, domain: null, priority: null, model: null,
  tags: ['agent'], depends: [], prdRef: null, entryPoint: null,
  acceptance: [], spec: null, externalRef: 'mod/TSK-01-01',
  agentPrompt: '기존 계약 유지',
}

describe('WbsSpecPanel 에이전트 프롬프트', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getWbsSpec.mockReset(); updateAgentPrompt.mockReset(); refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(editable: boolean, detail: Record<string, unknown> = DETAIL) {
    getWbsSpec.mockResolvedValue(detail)
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={editable} />) })
    await act(async () => {})
  }
  /** 프롬프트 textarea 는 편집 토글 뒤에 있다(2026-08-28) — 관리자도 켜야 보인다. */
  async function openEditor() {
    await act(async () => { container.querySelector<HTMLElement>('[data-spec-edit-toggle]')!.click() })
  }

  it('관리자 — 편집을 켜면 프롬프트 textarea 가 현재 값으로 렌더된다', async () => {
    await render(true)
    await openEditor()
    const ta = container.querySelector<HTMLTextAreaElement>('textarea[data-agent-prompt]')
    expect(ta).not.toBeNull()
    expect(ta!.value).toBe('기존 계약 유지')
  })

  it('blur 시 변경분만 updateAgentPrompt 로 저장한다', async () => {
    updateAgentPrompt.mockResolvedValue({ ok: true })
    await render(true)
    await openEditor()
    const ta = container.querySelector<HTMLTextAreaElement>('textarea[data-agent-prompt]')!
    await act(async () => {
      // React 제어 입력 — native setter 로 값 주입 후 이벤트
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '레거시 API 유지, 마이그레이션 금지')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      // React 의 onBlur 는 네이티브 focusout 위임 — 'blur' 이벤트로는 핸들러가 돌지 않는다.
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await Promise.resolve()
    })
    expect(updateAgentPrompt).toHaveBeenCalledWith('item-1', '레거시 API 유지, 마이그레이션 금지')
  })

  it('값이 그대로면 blur 에도 쓰지 않는다(멱등)', async () => {
    await render(true)
    await openEditor()
    const ta = container.querySelector<HTMLTextAreaElement>('textarea[data-agent-prompt]')!
    await act(async () => {
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await Promise.resolve()
    })
    expect(updateAgentPrompt).not.toHaveBeenCalled()
  })

  it('비관리자 — textarea 없음, 값은 읽기 전용 표시', async () => {
    await render(false)
    expect(container.querySelector('textarea[data-agent-prompt]')).toBeNull()
    expect(container.textContent).toContain('기존 계약 유지')
  })

  it('비관리자 + 프롬프트 없음 — 아무 표시 없음(빈 필드 노이즈 금지)', async () => {
    await render(false, { ...DETAIL, agentPrompt: null })
    expect(container.textContent).not.toContain('wbs.specAgentPromptLabel')
  })
})
