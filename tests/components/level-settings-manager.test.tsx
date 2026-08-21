// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateLevelSettings = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
const refresh = vi.fn()

vi.mock('@/app/actions/project', () => ({
  updateLevelSettings: (...a: unknown[]) => updateLevelSettings(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { LevelSettingsManager } from '@/components/settings/LevelSettingsManager'

function labelInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[data-level-label]'))
}

describe('LevelSettingsManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    updateLevelSettings.mockClear()
    updateLevelSettings.mockResolvedValue({ ok: true })
    refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(labels: string[] = ['Phase', 'Task', 'Activity']) {
    act(() => {
      root.render(<LevelSettingsManager projectId="proj-1" levelLabels={labels} />)
    })
  }

  it('현재 라벨을 단계당 입력 하나로 그린다', () => {
    render(['Phase', 'Task', 'Activity'])
    expect(labelInputs(container).map((i) => i.value)).toEqual(['Phase', 'Task', 'Activity'])
  })

  it('단계 추가를 누르면 빈 입력이 하나 늘어난다', () => {
    render(['Phase', 'Task'])
    const addBtn = container.querySelector<HTMLButtonElement>('button[data-add-level]')!
    act(() => addBtn.click())
    const inputs = labelInputs(container)
    expect(inputs).toHaveLength(3)
    expect(inputs[2].value).toBe('')
  })

  it('행 삭제를 누르면 그 단계가 빠진다', () => {
    render(['Phase', 'Task', 'Activity'])
    const removeBtns = container.querySelectorAll<HTMLButtonElement>('button[data-remove-level]')
    act(() => removeBtns[1].click())
    expect(labelInputs(container).map((i) => i.value)).toEqual(['Phase', 'Activity'])
  })

  it('저장하면 입력값 그대로 액션을 호출하고 성공 시 새로고침한다', async () => {
    render(['Phase', 'Task'])
    const inputs = labelInputs(container)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(inputs[1], 'System')
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
    await act(async () => { saveBtn.click() })
    expect(updateLevelSettings).toHaveBeenCalledWith('proj-1', ['Phase', 'System'])
    expect(refresh).toHaveBeenCalled()
  })

  it('액션 실패면 에러를 보여주고 새로고침하지 않는다', async () => {
    updateLevelSettings.mockResolvedValue({ ok: false, error: '기존 WBS 에 깊이 4단 항목이 있어 줄일 수 없습니다.' })
    render(['Phase', 'Task', 'Activity'])
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-save-levels]')!
    await act(async () => { saveBtn.click() })
    expect(container.textContent).toContain('줄일 수 없습니다')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('단계가 1개면 삭제 버튼이 없다 — 0단 상태를 만들 수 없다', () => {
    render(['Phase'])
    expect(container.querySelectorAll('button[data-remove-level]')).toHaveLength(0)
  })
})
