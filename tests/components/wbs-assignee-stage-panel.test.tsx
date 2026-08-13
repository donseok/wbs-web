// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProjectMember } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getWbsAssigneeStage = vi.fn(async () => ({ assigneeMemberId: null, stage: null, devWorkflow: false }))
const setWbsAssignee = vi.fn(async () => ({ ok: true }))
const setWbsAssigneeCascade = vi.fn(async () => ({ ok: true, count: 0 }))
const setWbsStage = vi.fn(async () => ({ ok: true }))
const setWbsDevWorkflow = vi.fn(async () => ({ ok: true, count: 1 }))

vi.mock('@/app/actions/wbsAssign', () => ({
  getWbsAssigneeStage: (...a: unknown[]) => getWbsAssigneeStage(...(a as [])),
  setWbsAssignee: (...a: unknown[]) => setWbsAssignee(...(a as [])),
  setWbsAssigneeCascade: (...a: unknown[]) => setWbsAssigneeCascade(...(a as [])),
  setWbsStage: (...a: unknown[]) => setWbsStage(...(a as [])),
  setWbsDevWorkflow: (...a: unknown[]) => setWbsDevWorkflow(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO', 'ERP'] }))
// WbsSpecPanel 은 이 테스트의 관심사가 아니다 — 자체 데이터 로드를 갖고 있어 no-op 처리한다.
vi.mock('@/components/wbs/WbsSpecPanel', () => ({ WbsSpecPanel: () => null }))

import { WbsAssigneeStagePanel } from '@/components/wbs/WbsAssigneeStagePanel'

const members: ProjectMember[] = []

describe('WbsAssigneeStagePanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    getWbsAssigneeStage.mockClear()
    setWbsAssignee.mockClear()
    setWbsAssigneeCascade.mockClear()
    setWbsStage.mockClear()
    setWbsDevWorkflow.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(opts: {
    editable?: boolean
    hasChildren?: boolean
    resolved?: { assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean }
  } = {}) {
    getWbsAssigneeStage.mockResolvedValue(
      opts.resolved ?? { assigneeMemberId: null, stage: null, devWorkflow: false },
    )
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

  const stageSelect = () => container.querySelector('select') as HTMLSelectElement
  const stageOptions = () => [...stageSelect().querySelectorAll('option')]
  const devWorkflowCheckbox = () =>
    [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      cb => cb.closest('label')?.textContent?.includes('wbs.devWorkflowLabel'),
    ) as HTMLInputElement

  it('(a) stage 셀렉트에 todo 옵션이 없고 as 라벨이 wbs.stageAs 키를 쓴다', async () => {
    await mount()
    const values = stageOptions().map(o => o.value)
    expect(values).not.toContain('todo')
    expect(values).toEqual(['', 'as', 'fp', 'ip', 'im', 'xx'])
    const asOption = stageOptions().find(o => o.value === 'as')!
    expect(asOption.textContent).toBe('wbs.stageAs')
  })

  it('(b) devWorkflow 체크박스를 토글하면 setWbsDevWorkflow(itemId, checked, cascade) 로 호출된다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    const cb = devWorkflowCheckbox()
    expect(cb).toBeTruthy()
    expect(cb.checked).toBe(false)
    await act(async () => cb.click())
    expect(setWbsDevWorkflow).toHaveBeenCalledWith('item-1', true, false)
    expect(container.textContent).toContain('wbs.devWorkflowResult')
  })

  it('(b-2) hasChildren=true 면 cascade 체크박스가 기본 on 이고 인자로 전달된다', async () => {
    await mount({ hasChildren: true, resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    const cb = devWorkflowCheckbox()
    await act(async () => cb.click())
    expect(setWbsDevWorkflow).toHaveBeenCalledWith('item-1', true, true)
  })

  it('(c) devWorkflow=false 여도 stage 셀렉트는 활성 상태이며 값 변경 시 setWbsStage 가 호출된다', async () => {
    await mount({ resolved: { assigneeMemberId: null, stage: null, devWorkflow: false } })
    const select = stageSelect()
    expect(select.disabled).toBe(false)
    await act(async () => {
      select.value = 'fp'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setWbsStage).toHaveBeenCalledWith('item-1', 'fp')
  })

  it('editable=false 면 devWorkflow 체크박스가 렌더되되 disabled 다', async () => {
    await mount({ editable: false, resolved: { assigneeMemberId: null, stage: null, devWorkflow: true } })
    const cb = devWorkflowCheckbox()
    expect(cb).toBeTruthy()
    expect(cb.checked).toBe(true)
    expect(cb.disabled).toBe(true)
  })
})
