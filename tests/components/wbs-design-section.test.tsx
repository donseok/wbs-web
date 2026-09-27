// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SAVE_DEBOUNCE_MS } from '@/components/wbs/useDebouncedSave'
import { designPanelOf, type DesignPanel, type DesignTarget } from '@/lib/agent/designPanel'
import type { ItemFacts } from '@/lib/domain/designGate'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsSpec = vi.fn()
const getAgentOrderForItem = vi.fn()
const getDesignPanel = vi.fn()
const setDelegationAndMode = vi.fn()
const designAccept = vi.fn()
const designConfirm = vi.fn()
const designReopen = vi.fn()
const refresh = vi.fn()

vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: (...a: unknown[]) => getWbsSpec(...(a as [])),
  updateWbsSpecFields: vi.fn(), updateAgentPrompt: vi.fn(), updateWbsSpec: vi.fn(),
}))
vi.mock('@/app/actions/designActions', () => ({
  getDesignPanel: (...a: unknown[]) => getDesignPanel(...(a as [])),
  setDelegationAndMode: (...a: unknown[]) => setDelegationAndMode(...(a as [])),
  designAccept: (...a: unknown[]) => designAccept(...(a as [])),
  designConfirm: (...a: unknown[]) => designConfirm(...(a as [])),
  designReopen: (...a: unknown[]) => designReopen(...(a as [])),
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
  category: 'dev', domain: null, priority: null, model: null,
  tags: ['agent'], depends: [], prdRef: null, entryPoint: null,
  acceptance: [], spec: null, externalRef: 'mod/TSK-01-01', agentPrompt: null, designMode: 'review',
}

const ITEM: ItemFacts = { mode: 'review', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: false, preds: 'met' }
type ActiveOrder = NonNullable<DesignTarget['active']>
const ORDER: ActiveOrder = {
  id: 'o-1', status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, claimedBy: null,
}
/** 서버와 같은 판정(designPanelOf)으로 패널을 만든다 — 화면 문구·사유·버튼·잠금이 규칙 원본(designGate)에서 온다. */
function panelOf(item: Partial<ItemFacts>, order: Partial<ActiveOrder> | null): DesignPanel {
  const active = order === null ? null : { ...ORDER, ...order }
  return designPanelOf({
    itemId: 'item-1', projectId: 'p-1', item: { ...ITEM, ...item }, active,
    orderStatuses: active ? [active.status] : [], lastReview: null,
  }, Date.now())
}
const found = (panel: DesignPanel, canAct = true) => ({ ok: true, panel, canAct })

/**
 * WBS 작업 패널의 설계 영역과 설계 방식(설계 상태 스펙 3절 화면 판정·7절 화면과 권한). 문구·사유·안내는 서버 판정의 문자열을
 * 그대로 보이고, 버튼은 위임 권한이 있을 때만 그린다. 위임 체크와 방식 select 는 debounce 저장의 한 칸이다.
 */
describe('WbsSpecPanel — 설계 영역·설계 방식', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    getWbsSpec.mockReset().mockResolvedValue(DETAIL)
    getAgentOrderForItem.mockReset().mockResolvedValue({ ok: true, order: null, priorOrders: [] })
    getDesignPanel.mockReset().mockResolvedValue(found(panelOf({}, ORDER)))
    setDelegationAndMode.mockReset().mockResolvedValue({ ok: true })
    designAccept.mockReset().mockResolvedValue({ ok: true })
    designConfirm.mockReset().mockResolvedValue({ ok: true })
    designReopen.mockReset().mockResolvedValue({ ok: true })
    refresh.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function render(detail: Record<string, unknown> = DETAIL, editable = true) {
    getWbsSpec.mockResolvedValue(detail)
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable={editable} />) })
    await act(async () => {})
    await act(async () => {})
  }
  async function openBody() {
    await act(async () => { q('[data-spec-body-toggle]')!.click() })
  }
  /** 본문을 펼치고 편집 토글을 켠다 — 관리자의 위임 체크·방식 select 는 그 안에 있다. */
  async function openEditing() {
    await act(async () => { q('[data-spec-body-toggle]')!.click() })
    await act(async () => { q('[data-spec-edit-toggle]')!.click() })
  }
  async function elapse(ms = SAVE_DEBOUNCE_MS) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }
  async function click(el: HTMLElement) {
    await act(async () => el.click())
    await act(async () => {})
  }
  async function type(el: HTMLElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function chooseMode(value: string) {
    await act(async () => {
      const s = q('[data-spec-design-mode]') as HTMLSelectElement
      s.value = value
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  const q = (sel: string) => container.querySelector<HTMLElement>(sel)
  const text = (sel: string) => q(sel)?.textContent ?? null
  const delegate = () => q('[data-spec-delegate]') as HTMLInputElement
  const chip = () => q('[data-pending-save]')

  // 계획서 Review Focus 4 — 팀장·워커가 설계를 되돌린 사유(design_note)가 보여야 사람이 무엇을 고칠지 안다.
  it.each([
    ['3절 6행 사람 설계 대기', { mode: 'human', stage: 'as' }, { status: 'ready', designNote: '빠진 절: 테스트 계획' }, 6, '사람 설계 대기', 'confirm'],
    ['3절 1행 설계 검토 대기', { mode: 'review', stage: 'dd' }, { status: 'claimed', designState: 'review', designNote: '5절 중 테스트 계획 없음' }, 1, '설계 검토 대기', 'accept'],
  ] as const)('%s — 화면 문구·되돌림 사유·안내를 서버 판정 그대로 보인다', async (_name, item, order, row, label, btn) => {
    const panel = panelOf(item, order)
    expect(panel.screen?.row).toBe(row)
    getDesignPanel.mockResolvedValue(found(panel))
    await render({ ...DETAIL, designMode: item.mode })
    expect(getDesignPanel).toHaveBeenCalledWith('item-1')
    expect(text('[data-spec-design] [data-design-label]')).toBe(label)
    expect(text('[data-spec-design] [data-design-note]')).toBe(order.designNote)
    expect(text('[data-spec-design] [data-design-hint]')).toBe(panel.screen?.hint)
    expect(q(`[data-design-btn="${btn}"]`)).not.toBeNull()
  })

  it('「설계 승인」 — 서버 액션을 부르고 설계 영역·진행 상황을 다시 읽는다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ stage: 'dd' }, { status: 'claimed', designState: 'review' })))
    await render()
    expect(getDesignPanel).toHaveBeenCalledTimes(1)
    await click(q('[data-design-btn="accept"]')!)
    expect(designAccept).toHaveBeenCalledWith('item-1')
    expect(getDesignPanel).toHaveBeenCalledTimes(2)
    expect(getAgentOrderForItem).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('버튼의 오류·경고는 설계 영역 안에 보이고, 실패해도 다시 읽는다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ mode: 'human', stage: 'as' }, { status: 'ready' })))
    designConfirm.mockResolvedValueOnce({ ok: false, error: '그 사이 상태가 바뀌었습니다 — 화면을 새로 고친 뒤 다시 보세요.' })
    await render({ ...DETAIL, designMode: 'human' })
    await click(q('[data-design-btn="confirm"]')!)
    expect(designConfirm).toHaveBeenCalledWith('item-1')
    expect(text('[data-spec-design] [role="alert"]')).toContain('그 사이 상태가 바뀌었습니다')
    expect(getDesignPanel).toHaveBeenCalledTimes(2)
    designConfirm.mockResolvedValueOnce({ ok: true, warning: '진척 스냅샷을 남기지 못했습니다' })
    await click(q('[data-design-btn="confirm"]')!)
    expect(text('[data-spec-design] [role="status"]')).toContain('진척 스냅샷을 남기지 못했습니다')
    expect(q('[data-spec-design] [role="alert"]')).toBeNull()
  })

  it('「설계 되돌리기」는 두 단계 — 누르면 사유 칸·제출 버튼이 열리고, 사유를 넘긴다. 비우면 빈 사유(서버 기본 사유). 승인된 설계면 빠져나오기 안내를 보인다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ stage: 'dd' }, { status: 'claimed', designState: 'accepted' })))
    await render()
    expect(text('[data-design-label]')).toContain('구현 대기(설계 승인됨)')
    expect(text('[data-design-exit-guide]')).toContain('wbs.designExitStep4')
    expect(q('[data-design-reopen-reason]')).toBeNull()
    expect(q('[data-design-reopen-submit]')).toBeNull()
    await click(q('[data-design-btn="reopen"]')!)
    expect(designReopen).not.toHaveBeenCalled()
    expect(q('[data-design-reopen-submit]')).not.toBeNull()
    await type(q('[data-design-reopen-reason]')!, '테스트 계획을 보강한다')
    await click(q('[data-design-reopen-submit]')!)
    expect(designReopen).toHaveBeenLastCalledWith('item-1', '테스트 계획을 보강한다')
    expect(q('[data-design-reopen-submit]')).toBeNull()
    await click(q('[data-design-btn="reopen"]')!)
    expect((q('[data-design-reopen-reason]') as HTMLInputElement).value).toBe('')
    await click(q('[data-design-reopen-submit]')!)
    expect(designReopen).toHaveBeenLastCalledWith('item-1', '')
  })

  it('위임 권한이 없으면(canAct=false) 버튼 없이 문구만 보인다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ stage: 'dd' }, { status: 'claimed', designState: 'review', designNote: '다시 봐 주세요' }), false))
    await render()
    expect(text('[data-design-label]')).toBe('설계 검토 대기')
    expect(text('[data-design-note]')).toBe('다시 봐 주세요')
    expect(q('[data-design-btn]')).toBeNull()
    expect(q('[data-design-reopen-reason]')).toBeNull()
    expect(container.textContent).toContain('wbs.designNoRight')
  })

  it('조회 실패는 오류로 보인다 — "설계 없음"으로 바꾸지 않는다(에러 3원칙)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    getDesignPanel.mockResolvedValue({ ok: false, error: '설계 상태를 읽지 못했습니다.' })
    await render()
    expect(text('[data-spec-design] [role="alert"]')).toContain('설계 상태를 읽지 못했습니다.')
    expect(q('[data-design-label]')).toBeNull()
    expect(log).toHaveBeenCalled()
  })

  it('서버 액션이 던져도(네트워크) 오류로 보인다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getDesignPanel.mockRejectedValue(new Error('network down'))
    await render()
    expect(text('[data-spec-design] [role="alert"]')).toContain('network down')
  })

  it('방식 잠금 — select 를 잠그고 서버가 준 이유(할 일 포함)를 보인다', async () => {
    const panel = panelOf({ stage: 'ds' }, { status: 'claimed' })
    expect(panel.modeLock).not.toBeNull()
    getDesignPanel.mockResolvedValue(found(panel))
    await render()
    await openEditing()
    expect((q('[data-spec-design-mode]') as HTMLSelectElement).disabled).toBe(true)
    expect(text('[data-design-mode-lock]')).toBe(panel.modeLock)
  })

  it('승인된 설계로 구현 중이면 agent 브랜치 push 경고를 보인다', async () => {
    const panel = panelOf({ stage: 'ip' }, { status: 'claimed', designState: 'accepted' })
    expect(panel.pushWarning).not.toBeNull()
    getDesignPanel.mockResolvedValue(found(panel))
    await render()
    expect(text('[data-design-push-warning]')).toBe(panel.pushWarning)
  })

  it('위임 체크와 방식 select 는 한 칸이다 — 둘을 바꾸면 setDelegationAndMode 한 번으로 함께 저장한다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ mode: 'auto', delegated: false }, null)))
    await render({ ...DETAIL, tags: [], designMode: 'auto' })
    await openEditing()
    expect((q('[data-spec-design-mode]') as HTMLSelectElement).value).toBe('auto')
    await chooseMode('review')
    await act(async () => delegate().click())
    expect(chip()?.getAttribute('data-pending-save')).toBe('pending')
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledTimes(1)
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', true, 'review')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('위임하지 않은 채 방식만 바꿔도 같은 액션으로 저장한다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ mode: 'auto', delegated: false }, null)))
    await render({ ...DETAIL, tags: [], designMode: 'auto' })
    await openEditing()
    await chooseMode('human')
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', false, 'human')
  })

  // 부분 성공 — 설계 영역 다시 읽기는 끝나지 않게 두어, 조회 결과가 아니라 저장 결과만으로 화면을 맞추는지 본다.
  it('켤 때 방식은 저장됐는데 위임만 실패하면(ok:false·modeChanged) 위임은 이전 값으로, 방식은 새 값으로 둔다', async () => {
    getDesignPanel.mockResolvedValueOnce(found(panelOf({ mode: 'auto', delegated: false }, null)))
      .mockReturnValue(new Promise(() => {}))
    setDelegationAndMode.mockResolvedValue({ ok: false, error: '위임하지 못했습니다', modeChanged: true })
    await render({ ...DETAIL, tags: [], designMode: 'auto' })
    await openEditing()
    await chooseMode('review')
    await act(async () => delegate().click())
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', true, 'review')
    expect(delegate().checked).toBe(false)
    expect((q('[data-spec-design-mode]') as HTMLSelectElement).value).toBe('review')
    expect(text('[role="alert"]')).toContain('위임하지 못했습니다')
  })

  it('끌 때 위임은 풀렸는데 방식 쓰기만 실패하면(ok·warning) 위임은 해제로, 방식은 이전 값으로 두고 경고를 보인다', async () => {
    getDesignPanel.mockResolvedValueOnce(found(panelOf({}, { status: 'ready' })))
      .mockReturnValue(new Promise(() => {}))
    setDelegationAndMode.mockResolvedValue({ ok: true, warning: '위임은 풀었지만 설계 방식을 바꾸지 못했습니다', modeChanged: false })
    await render()
    await openEditing()
    await chooseMode('human')
    await act(async () => delegate().click())
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', false, 'human')
    expect(delegate().checked).toBe(false)
    expect((q('[data-spec-design-mode]') as HTMLSelectElement).value).toBe('review')
    expect(container.textContent).toContain('위임은 풀었지만 설계 방식을 바꾸지 못했습니다')
  })

  it('설계 상태가 있으면 위임 해제 전에 인라인 확인을 받는다 — 확인을 눌러야 저장 칸이 바뀐다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    getDesignPanel.mockResolvedValue(found(panelOf({ stage: 'dd' }, { status: 'claimed', designState: 'review' })))
    await render()
    await openEditing()
    await act(async () => delegate().click())
    expect(text('[data-delegation-confirm]')).toContain('wbs.delegationOffConfirm')
    expect(delegate().checked).toBe(true)
    expect(chip()).toBeNull()
    await elapse()
    expect(setDelegationAndMode).not.toHaveBeenCalled()
    expect(q('[data-delegation-confirm] [data-delegation-confirm-ok]')).not.toBeNull()
    expect(q('[data-delegation-confirm] [data-delegation-confirm-cancel]')).not.toBeNull()
    await act(async () => q('[data-delegation-confirm] [data-delegation-confirm-cancel]')!.click())
    expect(q('[data-delegation-confirm]')).toBeNull()
    expect(delegate().checked).toBe(true)
    await act(async () => delegate().click())
    await act(async () => q('[data-delegation-confirm] [data-delegation-confirm-ok]')!.click())
    expect(q('[data-delegation-confirm]')).toBeNull()
    expect(delegate().checked).toBe(false)
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', false, 'review')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('설계 상태가 없으면 확인 없이 끈다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({}, { status: 'ready' })))
    await render()
    await openEditing()
    await act(async () => delegate().click())
    expect(q('[data-delegation-confirm]')).toBeNull()
    expect(delegate().checked).toBe(false)
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', false, 'review')
  })

  // D10 — 위임과 방식은 위임 권한(관리자 또는 담당자 본인)으로 바꾼다. 담당자에게는 편집 토글이 없으므로 canAct 로 두 칸을 연다.
  it('위임 권한이 있는 담당자(관리자 아님)는 편집 토글 없이 위임 체크와 방식 select 로 방식을 바꾼다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({}, { status: 'ready' }), true))
    await render(DETAIL, false)
    await openBody()
    expect(q('[data-spec-edit-toggle]')).toBeNull()
    expect(q('[data-spec-delegate]')).not.toBeNull()
    expect(delegate().checked).toBe(true)
    await chooseMode('human')
    await elapse()
    expect(setDelegationAndMode).toHaveBeenCalledWith('item-1', true, 'human')
  })

  it('위임 권한이 없으면(canAct=false) 위임 체크·방식 select 없이 현재 방식을 글자로 보인다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({}, { status: 'ready' }), false))
    await render(DETAIL, false)
    await openBody()
    expect(q('[data-spec-delegate]')).toBeNull()
    expect(q('[data-spec-design-mode]')).toBeNull()
    expect(container.textContent).toContain('wbs.designModeLabel · wbs.designModeReview')
  })

  it('명세에 designMode 가 없으면 설계 영역·방식 select 를 그리지 않고 조회도 하지 않는다', async () => {
    const legacy: Record<string, unknown> = { ...DETAIL }
    delete legacy.designMode
    await render(legacy)
    await openEditing()
    expect(q('[data-spec-design]')).toBeNull()
    expect(q('[data-spec-design-mode]')).toBeNull()
    expect(getDesignPanel).not.toHaveBeenCalled()
  })

  it('보일 것이 없는 완전자동 작업은 설계 영역을 그리지 않는다', async () => {
    getDesignPanel.mockResolvedValue(found(panelOf({ mode: 'auto', delegated: false }, null)))
    await render({ ...DETAIL, tags: [], designMode: 'auto' })
    expect(getDesignPanel).toHaveBeenCalledWith('item-1')
    expect(q('[data-spec-design]')).toBeNull()
  })
})
