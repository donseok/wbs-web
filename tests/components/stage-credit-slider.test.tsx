// @vitest-environment jsdom
// 개발 워크플로 크레딧 슬라이더(스펙 2026-09-15 §5.1, 표 단일화 2026-09-16) — 표 하나·XX 자물쇠·직접 입력
// 클램프·키보드·눈금·저장.
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

  const input = (key: string) => container.querySelector<HTMLInputElement>(`[data-credit-input="${key}"]`)!
  const handle = (key: string) => container.querySelector<HTMLElement>(`[data-credit-handle="${key}"]`)!
  const saveBtn = () => container.querySelector<HTMLButtonElement>('[data-credit-save]')
  async function mount(props: Partial<Parameters<typeof StageCreditSlider>[0]> = {}) {
    await act(async () => root.render(<StageCreditSlider projectId="p1" initial={null} editable {...props} />))
  }
  async function type(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }

  it('표는 하나뿐이고 설정이 없으면 코드 기본값으로 그린다', async () => {
    await mount()
    expect(container.querySelectorAll('[data-credit-table]')).toHaveLength(1)
    expect(['as', 'ip', 'rw', 'im'].map(k => input(k).value)).toEqual(['0', '30', '50', '80'])
    expect(handle('rw').style.left).toBe('50%')
    expect(saveBtn()!.disabled).toBe(true) // 바뀐 것이 없다
  })

  it('XX 는 입력 칸이 없고 자물쇠 핸들로 100 에 고정된다', async () => {
    await mount()
    expect(container.querySelector('[data-credit-input="xx"]')).toBeNull()
    const lock = handle('xx')
    expect(lock.hasAttribute('data-credit-locked')).toBe(true)
    expect(lock.getAttribute('role')).toBe('img')          // 조절할 수 없으므로 slider 가 아니다
    expect(lock.style.left).toBe('100%')
    expect(container.querySelector('[data-credit-fixed="xx"]')?.textContent).toBe('100')
  })

  it('눈금은 5 간격으로 긋고 10 간격마다 숫자를 붙인다', async () => {
    await mount()
    const scale = container.querySelector('[data-credit-scale]')!
    expect(scale.querySelectorAll('[data-credit-tick]').length).toBe(21)
    expect([...scale.querySelectorAll('[data-credit-tick-label]')].map(e => e.textContent))
      .toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'])
    expect(scale.querySelector<HTMLElement>('[data-credit-tick="45"]')!.style.left).toBe('45%')
    expect(scale.querySelector('[data-credit-tick="45"] [data-credit-tick-label]')).toBeNull()
  })

  it('직접 입력은 포커스를 벗어날 때 5 단위·이웃 간격으로 클램프된다', async () => {
    await mount()
    await type(input('ip'), '48')
    expect(input('ip').value).toBe('40') // rw(50) - 10
    await type(input('rw'), '7')
    expect(input('rw').value).toBe('50') // ip(40) + 10 = 50 보다 작게는 못 간다
  })

  it('핸들 키보드: 오른쪽 화살표 +5, Home 은 아래 한계로', async () => {
    await mount()
    await act(async () => { handle('im').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(input('im').value).toBe('85')
    await act(async () => { handle('im').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(input('im').value).toBe('60') // rw(50) + 10
  })

  it('저장은 검증된 표로 액션을 부르고, 성공하면 저장됨 표시 + 새로고침', async () => {
    await mount({ initial: { default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 } } })
    await type(input('rw'), '60')
    await act(async () => { saveBtn()!.click() })
    expect(updateStageCredits).toHaveBeenCalledWith('p1', { default: { as: 0, ip: 30, rw: 60, im: 80, xx: 100 } })
    expect(container.querySelector('[data-credit-saved]')).not.toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('저장 실패는 서버 문구를 그대로 보인다', async () => {
    updateStageCredits.mockResolvedValue({ ok: false, error: '권한 없음' })
    await mount()
    await type(input('rw'), '60')
    await act(async () => { saveBtn()!.click() })
    expect(container.querySelector('[data-credit-error]')?.textContent).toBe('권한 없음')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('미리보기는 지금 값으로 사건 흐름을 보여 주고, 행을 누르면 현재 위치가 옮겨간다', async () => {
    await mount()
    const rows = container.querySelectorAll('[data-credit-pv-row]')
    expect(rows).toHaveLength(7)
    const actual = (i: number) => container.querySelector(`[data-credit-pv-actual="${i}"]`)!.textContent
    expect(actual(0)).toContain('0')    // 위임 체크 ON → as
    expect(actual(1)).toContain('30')   // claim → ip
    expect(actual(4)).toContain('100')  // 승인 → xx
    // 계획 진척 60 이 기본이라 실적 30 은 지연, 100 은 완료다.
    expect(container.querySelector('[data-credit-pv-status="1"]')?.textContent).toBe('settings.creditPvDelayed')
    expect(container.querySelector('[data-credit-pv-status="4"]')?.textContent).toBe('settings.creditPvDone')
    // 기본 현재 위치는 반려·재작업(50). 행을 누르면 채움이 그 값으로 간다.
    const fill = () => container.querySelector<HTMLElement>('[data-credit-fill]')!
    expect(fill().style.width).toBe('50%')
    await act(async () => { (rows[1] as HTMLElement).click() })
    expect(fill().style.width).toBe('30%')
    await act(async () => { (rows[2] as HTMLElement).click() })
    expect(container.querySelector('[data-credit-manual-mark]')).not.toBeNull()
  })

  it('읽기 전용이면 저장 버튼이 없고 입력은 읽기 전용이다', async () => {
    await mount({ editable: false })
    expect(saveBtn()).toBeNull()
    expect(input('ip').readOnly).toBe(true)
    expect(handle('ip').getAttribute('aria-disabled')).toBe('true')
  })
})
