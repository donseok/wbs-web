// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SAVE_DEBOUNCE_MS } from '@/components/wbs/useDebouncedSave'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpec = vi.fn()
const updateWbsSpecFields = vi.fn()
const setAgentDelegation = vi.fn()
const getAgentOrderForItem = vi.fn()
const refresh = vi.fn()

vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  updateWbsSpecFields: (...a: unknown[]) => updateWbsSpecFields(...(a as [])),
  setAgentDelegation: (...a: unknown[]) => setAgentDelegation(...(a as [])),
  updateAgentPrompt: vi.fn(),
  updateWbsSpec: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: (...a: unknown[]) => getAgentOrderForItem(...(a as [])),
  approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(), requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const DETAIL = {
  category: 'dev', domain: null, priority: 'high', model: null,
  tags: ['ui'], depends: [], prdRef: null, entryPoint: null,
  acceptance: [], spec: null, externalRef: 'mod/TSK-01-01', agentPrompt: null,
}

/**
 * 우선순위 select·위임 체크박스는 debounce 저장이다(2026-09-14). 종전엔 체크 하나마다 서버 액션 +
 * router.refresh() 가 나가 WBS 페이지 전체가 다시 렌더됐다(스테이징 실측 refresh 1회 ≈ 0.5초).
 */
describe('WbsSpecPanel — 우선순위·위임의 debounce 저장', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    getWbsSpec.mockReset().mockResolvedValue(DETAIL)
    updateWbsSpecFields.mockReset().mockResolvedValue({ ok: true })
    setAgentDelegation.mockReset().mockResolvedValue({ ok: true })
    getAgentOrderForItem.mockReset().mockResolvedValue({ ok: true, order: null, priorOrders: [] })
    refresh.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function render(itemId = 'item-1') {
    await act(async () => { root.render(<WbsSpecPanel itemId={itemId} editable />) })
    await act(async () => {})
  }
  /** 본문을 펼치고 편집 토글을 켠다 — select·체크박스는 그 안에 있다. */
  async function openEditing() {
    await act(async () => { q('[data-spec-body-toggle]')!.click() })
    await act(async () => { q('[data-spec-edit-toggle]')!.click() })
  }
  async function elapse(ms = SAVE_DEBOUNCE_MS) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)
  const delegate = () => q('[data-spec-delegate]') as HTMLInputElement
  const priority = () => q('[data-spec-priority]') as HTMLSelectElement
  const chip = () => q('[data-pending-save]')
  async function choosePriority(value: string) {
    await act(async () => {
      priority().value = value
      priority().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('위임 체크는 바로 저장하지 않는다 — 낙관 표시 + 대기 칩, SAVE_DEBOUNCE_MS 뒤 저장 + refresh 1회', async () => {
    await render()
    await openEditing()
    expect(chip()).toBeNull()
    await act(async () => delegate().click())
    expect(delegate().checked).toBe(true)
    expect(chip()?.getAttribute('data-pending-save')).toBe('pending')
    expect(setAgentDelegation).not.toHaveBeenCalled()
    await elapse(SAVE_DEBOUNCE_MS - 1)
    expect(setAgentDelegation).not.toHaveBeenCalled()
    await elapse(1)
    expect(setAgentDelegation).toHaveBeenCalledWith('item-1', true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(chip()).toBeNull()
    expect(getAgentOrderForItem).toHaveBeenCalledTimes(2) // 위임이 주문을 발행하므로 진행 상황을 다시 읽는다
  })

  it('위임 on 뒤 off — 원래 값으로 돌아왔으니 저장하지 않는다', async () => {
    await render()
    await openEditing()
    await act(async () => delegate().click())
    await act(async () => delegate().click())
    expect(delegate().checked).toBe(false)
    expect(chip()).toBeNull()
    await elapse()
    expect(setAgentDelegation).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('우선순위와 위임을 함께 바꾸면 한 flush 에 순서대로 저장하고 refresh 는 1회다', async () => {
    const order: string[] = []
    updateWbsSpecFields.mockImplementation(async () => { order.push('priority'); return { ok: true } })
    setAgentDelegation.mockImplementation(async () => { order.push('delegate'); return { ok: true } })
    await render()
    await openEditing()
    await choosePriority('low')
    await act(async () => delegate().click())
    await elapse()
    expect(updateWbsSpecFields).toHaveBeenCalledWith('item-1', { priority: 'low' })
    expect(setAgentDelegation).toHaveBeenCalledWith('item-1', true)
    expect(order).toEqual(['priority', 'delegate'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('「지금 저장」은 기다리지 않는다', async () => {
    await render()
    await openEditing()
    await choosePriority('low')
    await act(async () => q('[data-pending-save-now]')!.click())
    await act(async () => {})
    expect(updateWbsSpecFields).toHaveBeenCalledWith('item-1', { priority: 'low' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('저장 실패 — 체크를 되돌리고 오류를 alert 로 띄운다', async () => {
    setAgentDelegation.mockResolvedValue({ ok: false, error: '권한이 없습니다' })
    await render()
    await openEditing()
    await act(async () => delegate().click())
    expect(delegate().checked).toBe(true)
    await elapse()
    expect(delegate().checked).toBe(false)
    expect(q('[role="alert"]')?.textContent).toContain('권한이 없습니다')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ok 인데 warning — 저장은 반영하되 경고 문구를 그대로 보여준다(위장 금지)', async () => {
    setAgentDelegation.mockResolvedValue({ ok: true, warning: '프로젝트가 중지 상태라 주문을 발행하지 않았습니다' })
    await render()
    await openEditing()
    await act(async () => delegate().click())
    await elapse()
    expect(delegate().checked).toBe(true)
    expect(container.textContent).toContain('프로젝트가 중지 상태라 주문을 발행하지 않았습니다')
  })

  it('편집 토글을 닫아도 대기는 유지된다 — 칩은 머리에 남고 시간이 되면 저장한다', async () => {
    await render()
    await openEditing()
    await act(async () => delegate().click())
    await act(async () => { q('[data-spec-edit-toggle]')!.click() })
    expect(q('[data-spec-delegate]')).toBeNull()
    expect(chip()).not.toBeNull()
    // 접혀 있어도 배지는 낙관 값을 보인다
    expect(container.textContent).toContain('agent')
    await elapse()
    expect(setAgentDelegation).toHaveBeenCalledWith('item-1', true)
  })

  it('항목이 바뀌면(itemId) 이전 항목의 변경을 즉시 저장하고 새 항목은 깨끗하다', async () => {
    await render('item-1')
    await openEditing()
    await act(async () => delegate().click())
    await render('item-2')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(setAgentDelegation).toHaveBeenCalledWith('item-1', true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(chip()).toBeNull()
    await elapse()
    expect(setAgentDelegation).toHaveBeenCalledTimes(1)
  })
})
