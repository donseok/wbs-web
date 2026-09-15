// @vitest-environment jsdom
// 개발 워크플로 크레딧 슬라이더(스펙 2026-09-15 §5.1) — 기본값 표시·XX 잠금·직접 입력 클램프·키보드·저장.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateStageCredits = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
const refresh = vi.fn()
vi.mock('@/app/actions/project', () => ({ updateStageCredits: (...a: unknown[]) => updateStageCredits(...(a as [])) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))

import { StageCreditSlider } from '@/components/settings/StageCreditSlider'

describe('StageCreditSlider', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    updateStageCredits.mockReset().mockResolvedValue({ ok: true })
    refresh.mockReset()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const input = (table: string, key: string) => container.querySelector<HTMLInputElement>(`[data-credit-table="${table}"] [data-credit-input="${key}"]`)!
  const handle = (table: string, key: string) => container.querySelector<HTMLElement>(`[data-credit-table="${table}"] [data-credit-handle="${key}"]`)!
  const saveBtn = () => container.querySelector<HTMLButtonElement>('[data-credit-save]')
  async function mount(props: Partial<Parameters<typeof StageCreditSlider>[0]> = {}) {
    await act(async () => root.render(<StageCreditSlider projectId="p1" initial={null} editable {...props} />))
  }
  async function type(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }

  it('설정이 없으면 코드 기본값(기본·IF·DOC)으로 그리고 XX 는 100 에 잠긴다', async () => {
    await mount()
    expect(['as', 'ip', 'rw', 'im', 'xx'].map(k => input('default', k).value)).toEqual(['0', '30', '50', '80', '100'])
    expect(container.querySelector('[data-credit-table="if"]')).not.toBeNull()
    expect(input('default', 'xx').readOnly).toBe(true)
    expect(handle('default', 'xx').getAttribute('aria-disabled')).toBe('true')
    expect(handle('default', 'rw').style.left).toBe('50%')
    expect(saveBtn()!.disabled).toBe(true) // 바뀐 것이 없다
  })

  it('직접 입력은 포커스를 벗어날 때 5 단위·이웃 간격으로 클램프된다', async () => {
    await mount()
    await type(input('default', 'ip'), '48')
    expect(input('default', 'ip').value).toBe('40') // rw(50) - 10
    await type(input('default', 'rw'), '7')
    expect(input('default', 'rw').value).toBe('50') // ip(40) + 10 = 50 보다 작게는 못 간다
  })

  it('핸들 키보드: 오른쪽 화살표 +5, Home 은 아래 한계로', async () => {
    await mount()
    await act(async () => { handle('default', 'im').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(input('default', 'im').value).toBe('85')
    await act(async () => { handle('default', 'im').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(input('default', 'im').value).toBe('60') // rw(50) + 10
  })

  it('저장은 검증된 표로 액션을 부르고, 성공하면 저장됨 표시 + 새로고침', async () => {
    await mount({ initial: { default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 } } })
    expect(container.querySelector('[data-credit-table="if"]')).toBeNull()
    await type(input('default', 'rw'), '60')
    await act(async () => { saveBtn()!.click() })
    expect(updateStageCredits).toHaveBeenCalledWith('p1', { default: { as: 0, ip: 30, rw: 60, im: 80, xx: 100 } })
    expect(container.querySelector('[data-credit-saved]')).not.toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('저장 실패는 서버 문구를 그대로 보인다', async () => {
    updateStageCredits.mockResolvedValue({ ok: false, error: '권한 없음' })
    await mount()
    await type(input('default', 'rw'), '60')
    await act(async () => { saveBtn()!.click() })
    expect(container.querySelector('[data-credit-error]')?.textContent).toBe('권한 없음')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('카테고리 표는 제거·추가할 수 있고 기본 표는 제거할 수 없다', async () => {
    await mount()
    expect(container.querySelector('[data-credit-table="default"] [data-credit-remove]')).toBeNull()
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-credit-table="doc"] [data-credit-remove]')!.click() })
    expect(container.querySelector('[data-credit-table="doc"]')).toBeNull()
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-credit-add="doc"]')!.click() })
    expect(input('doc', 'im').value).toBe('50')
  })

  it('읽기 전용이면 저장·추가 버튼이 없고 입력은 읽기 전용이다', async () => {
    await mount({ editable: false })
    expect(saveBtn()).toBeNull()
    expect(container.querySelector('[data-credit-add]')).toBeNull()
    expect(input('default', 'ip').readOnly).toBe(true)
  })
})
