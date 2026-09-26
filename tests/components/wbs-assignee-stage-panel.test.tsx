// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProjectMember } from '@/lib/domain/types'
import { SAVE_DEBOUNCE_MS } from '@/components/wbs/useDebouncedSave'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type ResolvedState = {
  assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean
  delegated?: boolean; canDevWorkflow?: boolean
}
const getWbsAssigneeStage = vi.fn(async (): Promise<ResolvedState> => ({ assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: true }))
const setWbsAssignee = vi.fn(async () => ({ ok: true }))
const setWbsAssigneeCascade = vi.fn(async () => ({ ok: true, count: 0 }))
const setWbsStage = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
const setWbsDevWorkflow = vi.fn(async () => ({ ok: true, count: 1 }))
const refresh = vi.fn()

vi.mock('@/app/actions/wbsAssign', () => ({
  getWbsAssigneeStage: (...a: unknown[]) => getWbsAssigneeStage(...(a as [])),
  setWbsAssignee: (...a: unknown[]) => setWbsAssignee(...(a as [])),
  setWbsAssigneeCascade: (...a: unknown[]) => setWbsAssigneeCascade(...(a as [])),
  setWbsStage: (...a: unknown[]) => setWbsStage(...(a as [])),
  setWbsDevWorkflow: (...a: unknown[]) => setWbsDevWorkflow(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO', 'ERP'] }))
// WbsSpecPanel 은 이 테스트의 관심사가 아니다 — 자체 데이터 로드를 갖고 있어 no-op 처리한다.
vi.mock('@/components/wbs/WbsSpecPanel', () => ({ WbsSpecPanel: () => null }))

import { WbsAssigneeStagePanel } from '@/components/wbs/WbsAssigneeStagePanel'

const members: ProjectMember[] = []

/**
 * 담당·단계·dev workflow 는 debounce 저장이다(2026-09-14) — 변경 직후에는 서버를 부르지 않고
 * 마지막 변경 뒤 SAVE_DEBOUNCE_MS 가 지나야 한 번에 저장한다. 즉시 저장을 전제하던 단언은
 * fake timers 로 그 시간을 흘려 보낸 뒤 단언한다.
 */
describe('WbsAssigneeStagePanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    // mockClear 는 mockResolvedValueOnce 잔재를 지우지 않는다 — 실패한 테스트가 남긴 Once 값이
    // 다음 테스트의 첫 조회에 실려 오지 않도록 reset 뒤 기본 구현을 다시 건다.
    getWbsAssigneeStage.mockReset().mockResolvedValue({ assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: true })
    setWbsAssignee.mockReset().mockResolvedValue({ ok: true })
    setWbsAssigneeCascade.mockReset().mockResolvedValue({ ok: true, count: 0 })
    setWbsStage.mockReset().mockResolvedValue({ ok: true })
    setWbsDevWorkflow.mockReset().mockResolvedValue({ ok: true, count: 1 })
    refresh.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // AssigneeComboBox 가 하이라이트 옵션을 scrollIntoView 하는데 jsdom 에 미구현이다.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function mount(opts: {
    editable?: boolean
    hasChildren?: boolean
    resolved?: ResolvedState
  } = {}) {
    // canDevWorkflow 는 개별 테스트가 관심 없으면 "권한 있음"으로 둔다 — 이 값을 명시한
    // 테스트(권한·위임 잠금)는 그대로 덮어쓴다.
    getWbsAssigneeStage.mockResolvedValue({
      canDevWorkflow: true,
      ...(opts.resolved ?? { assigneeMemberId: null, stage: null, devWorkflow: true }),
    })
    await act(async () =>
      root.render(
        <WbsAssigneeStagePanel
          itemId="item-1"
          members={members}
          editable={opts.editable ?? true}
          hasChildren={opts.hasChildren ?? false}
        />,
      ),
    )
    // getWbsAssigneeStage 는 useEffect 안에서 비동기로 리졸브된다 — 한 틱 더 플러시.
    await act(async () => {})
  }
  /** debounce 창을 흘려 보내고 flush(서버 액션 직렬 호출 + 재조회 + refresh)까지 끝낸다. */
  async function elapse(ms = SAVE_DEBOUNCE_MS) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  const stageSelect = () => container.querySelector('select') as HTMLSelectElement
  const stageOptions = () => [...stageSelect().querySelectorAll('option')]
  const devWorkflowCheckbox = () =>
    [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      cb => cb.closest('label')?.textContent?.includes('wbs.devWorkflowLabel'),
    ) as HTMLInputElement
  const cascadeCheckbox = (labelKey: string) =>
    [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      cb => cb.closest('label')?.textContent?.includes(labelKey),
    ) as HTMLInputElement
  const pendingChip = () => container.querySelector<HTMLElement>('[data-pending-save]')
  const saveNow = () => container.querySelector<HTMLButtonElement>('[data-pending-save-now]')
  async function changeStage(value: string) {
    await act(async () => {
      stageSelect().value = value
      stageSelect().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('(a) stage 셀렉트에 todo 옵션이 없고 as 라벨이 wbs.stageAs 키를 쓴다', async () => {
    await mount()
    const values = stageOptions().map(o => o.value)
    expect(values).not.toContain('todo')
    expect(values).toEqual(['', 'as', 'ds', 'ip', 'im', 'xx'])
    const asOption = stageOptions().find(o => o.value === 'as')!
    expect(asOption.textContent).toBe('wbs.stageAs')
  })

  it('(b) devWorkflow 체크박스를 토글하면 SAVE_DEBOUNCE_MS 뒤 setWbsDevWorkflow(itemId, checked, cascade) 로 호출된다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    const cb = devWorkflowCheckbox()
    expect(cb).toBeTruthy()
    expect(cb.checked).toBe(false)
    expect(pendingChip()).toBeNull()
    await act(async () => cb.click())
    // 낙관 표시 + 대기 칩. 서버는 아직 부르지 않는다.
    expect(devWorkflowCheckbox().checked).toBe(true)
    expect(pendingChip()?.getAttribute('data-pending-save')).toBe('pending')
    expect(container.textContent).toContain('wbs.pendingSaveIn')
    expect(setWbsDevWorkflow).not.toHaveBeenCalled()
    await elapse()
    expect(setWbsDevWorkflow).toHaveBeenCalledWith('item-1', true, false)
    expect(container.textContent).toContain('wbs.devWorkflowResult')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(pendingChip()).toBeNull()
  })

  it('(b-2) hasChildren=true 면 cascade 체크박스가 기본 on 이고 인자로 전달된다', async () => {
    await mount({ hasChildren: true, resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    const cb = devWorkflowCheckbox()
    await act(async () => cb.click())
    await elapse()
    expect(setWbsDevWorkflow).toHaveBeenCalledWith('item-1', true, true)
  })

  it('(b-3) 전파 체크는 저장이 나가는 순간의 값을 쓴다 — 대기 중에 끄면 cascade=false 로 간다', async () => {
    await mount({ hasChildren: true, resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    await act(async () => devWorkflowCheckbox().click())
    await act(async () => cascadeCheckbox('wbs.devWorkflowCascadeLabel').click())
    await elapse()
    expect(setWbsDevWorkflow).toHaveBeenCalledWith('item-1', true, false)
  })

  // 단계는 개발 워크플로 항목의 것이다(스펙 2026-09-15 §3.5) — 꺼진 항목에는 드롭다운을 두지 않는다.
  it('(c-0) devWorkflow=false 면 단계 드롭다운을 두지 않고 안내문을 보인다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('[data-stage-not-workflow]')?.textContent).toBe('wbs.stageNotWorkflow')
  })

  it('(c-1) 위임된 작업은 단계 드롭다운을 잠그고 안내문을 보인다 — 단계는 승인·반려로 바뀐다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: 'ip', devWorkflow: true, delegated: true } })
    expect(stageSelect().disabled).toBe(true)
    expect(container.querySelector('[data-stage-locked]')?.textContent).toBe('wbs.stageLockedByOrder')
  })

  it('(c) devWorkflow=true 면 stage 셀렉트가 활성이고 값 변경 시 SAVE_DEBOUNCE_MS 뒤 setWbsStage 가 호출된다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    expect(stageSelect().disabled).toBe(false)
    await changeStage('im')
    expect(stageSelect().value).toBe('im') // 낙관 표시
    expect(setWbsStage).not.toHaveBeenCalled()
    await elapse()
    expect(setWbsStage).toHaveBeenCalledWith('item-1', 'im')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('(c-2) 같은 필드를 여러 번 바꾸면 마지막 값만, 원래 값으로 돌아오면 저장하지 않는다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: 'as', devWorkflow: true } })
    await changeStage('im')
    await changeStage('ip')
    await elapse()
    expect(setWbsStage).toHaveBeenCalledTimes(1)
    expect(setWbsStage).toHaveBeenCalledWith('item-1', 'ip')

    await changeStage('im')
    await changeStage('ip') // 서버 확정 값(직전 저장)으로 복귀
    expect(pendingChip()).toBeNull()
    await elapse()
    expect(setWbsStage).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('(d) 여러 필드를 바꿔도 한 flush 에 순서대로 저장하고 router.refresh 는 1회다', async () => {
    const order: string[] = []
    setWbsStage.mockImplementation(async () => { order.push('stage'); return { ok: true } })
    setWbsDevWorkflow.mockImplementation(async () => { order.push('devWorkflow'); return { ok: true, count: 1 } })
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    await changeStage('im')
    await act(async () => devWorkflowCheckbox().click())
    await elapse()
    expect(order).toEqual(['stage', 'devWorkflow'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('(e) 「지금 저장」을 누르면 기다리지 않고 저장한다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    await changeStage('im')
    expect(saveNow()).not.toBeNull()
    await act(async () => saveNow()!.click())
    await act(async () => {})
    expect(setWbsStage).toHaveBeenCalledWith('item-1', 'im')
    expect(refresh).toHaveBeenCalledTimes(1)
    await elapse()
    expect(setWbsStage).toHaveBeenCalledTimes(1) // 타이머가 다시 쏘지 않는다
  })

  it('(e-2) 저장이 실패하면 값을 되돌리고 오류를 표시한다 — 실패를 위장하지 않는다', async () => {
    setWbsStage.mockResolvedValue({ ok: false, error: '허용되지 않는 단계입니다.' })
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    await changeStage('im')
    expect(stageSelect().value).toBe('im')
    await elapse()
    expect(stageSelect().value).toBe('')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('허용되지 않는 단계입니다.')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('(f) 담당자 변경 성공 후 getWbsAssigneeStage 재조회로 loaded 전체가 교체된다(부분 낙관 갱신 아님, F2 최종 리뷰)', async () => {
    await mount({ resolved: { assigneeMemberId: 'm-1', stage: null, devWorkflow: true } })
    expect(getWbsAssigneeStage).toHaveBeenCalledTimes(1)
    // 서버가 배정과 함께 stage 도 as 로 바꿨다고 가정 — 재조회가 그 결과를 실어와야 한다.
    getWbsAssigneeStage.mockResolvedValueOnce({ assigneeMemberId: null, stage: 'as', devWorkflow: true })
    const input = container.querySelector('input[role="combobox"]') as HTMLInputElement
    await act(async () => { input.focus() })
    const option = [...container.querySelectorAll('[role="option"]')]
      .find(o => o.textContent === 'wbs.assigneeUnassignedOption') as HTMLElement
    expect(option).toBeTruthy()
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(setWbsAssignee).not.toHaveBeenCalled()
    expect(getWbsAssigneeStage).toHaveBeenCalledTimes(1)
    await elapse()
    expect(setWbsAssignee).toHaveBeenCalledWith('item-1', null)
    expect(getWbsAssigneeStage).toHaveBeenCalledTimes(2)
    expect(stageSelect().value).toBe('as')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('(g) 패널이 닫히면(언마운트) 대기 중인 변경을 기다리지 않고 저장한다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    await changeStage('im')
    expect(setWbsStage).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
    root = createRoot(container) // afterEach 의 unmount 가 두 번 되지 않게
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(setWbsStage).toHaveBeenCalledWith('item-1', 'im')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  // 2026-09-16 이전에는 editable(관리자)만 이 체크박스를 눌렀다. 이제 축이 canDevWorkflow 로
  // 바뀌었으므로 "권한 없음"은 그 값으로 표현한다 — 렌더는 하되 disabled 인 계약은 그대로다.
  it('권한이 없으면 devWorkflow 체크박스가 렌더되되 disabled 다', async () => {
    await mount({ editable: false, resolved: { assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: false } })
    const cb = devWorkflowCheckbox()
    expect(cb).toBeTruthy()
    expect(cb.checked).toBe(true)
    expect(cb.disabled).toBe(true)
  })

  // 개발 워크플로 단계는 최종단계(자식 없는 항목)의 것이다 — 상위 항목에서 고를 수 있으면
  // 서버가 거절하는 값을 화면이 권하는 꼴이 된다.
  it('자식이 있으면 단계 선택지는 "미착수" 하나뿐이다 — 잘못 찍힌 값을 지울 길은 남긴다', async () => {
    await mount({ hasChildren: true })
    const select = [...container.querySelectorAll('select')].at(-1)!
    expect([...select.options].map(o => o.value)).toEqual([''])
    expect(container.textContent).toContain('wbs.stageLeafOnlyHint')
  })

  it('자식이 없으면 다섯 단계를 모두 고를 수 있다(fp 는 0096 에서 제거, ds 는 0107 에서 추가)', async () => {
    await mount({ hasChildren: false })
    const select = [...container.querySelectorAll('select')].at(-1)!
    expect([...select.options].map(o => o.value)).toEqual(['', 'as', 'ds', 'ip', 'im', 'xx'])
    expect(container.textContent).not.toContain('wbs.stageLeafOnlyHint')
  })

  // ── 개발 워크플로 체크박스의 활성 조건(2026-09-16) ──────────────────────────────
  // 관리자 전용(editable)이 아니라 서버가 보낸 canDevWorkflow 를 본다. 위임된 작업은 끄지 못한다.

  it('canDevWorkflow=true 면 비관리자(editable=false)에게도 devWorkflow 체크박스가 열린다', async () => {
    await mount({ editable: false, resolved: { assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: true } })
    expect(devWorkflowCheckbox().disabled).toBe(false)
  })

  it('canDevWorkflow=false 면 관리자 폼(editable=true)이라도 체크박스가 잠긴다', async () => {
    await mount({ editable: true, resolved: { assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: false } })
    expect(devWorkflowCheckbox().disabled).toBe(true)
  })

  it('위임된 작업은 체크박스를 잠그고 사유를 보인다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: 'ip', devWorkflow: true, delegated: true, canDevWorkflow: true } })
    expect(devWorkflowCheckbox().disabled).toBe(true)
    expect(container.querySelector('[data-dev-workflow-locked]')?.textContent)
      .toContain('wbs.devWorkflowLockedByDelegation')
  })


  it('일괄 OFF 에서 제외된 위임 항목 수를 알린다', async () => {
    setWbsDevWorkflow.mockResolvedValue({ ok: true, count: 3, skippedDelegated: 2 } as never)
    await mount({ hasChildren: true, resolved: { assigneeMemberId: null, stage: null, devWorkflow: true, canDevWorkflow: true } })
    await act(async () => devWorkflowCheckbox().click())
    await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(container.querySelector('[data-dev-workflow-skipped]')?.textContent)
      .toContain('wbs.devWorkflowSkippedDelegated')
  })

})
