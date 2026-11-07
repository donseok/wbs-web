// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const save = vi.fn()
const toast = vi.fn()
vi.mock('@/app/actions/minutes', () => ({ updateMinuteBody: (...args: unknown[]) => save(...args) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
import { MinuteBodyModal } from '@/components/minutes/MinuteBodyModal'

describe('회의록 본문 편집', () => {
  let root: Root
  let container: HTMLDivElement
  const onClose = vi.fn()
  const onSaved = vi.fn()
  beforeEach(async () => {
    vi.clearAllMocks()
    save.mockResolvedValue({ ok: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<MinuteBodyModal minuteId="m1" bodyMd="기존 본문" onClose={onClose} onSaved={onSaved} />))
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const button = (key: string) => [...document.querySelectorAll('button')].find(b => b.textContent === key)!
  async function edit(value: string) {
    const area = document.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value)
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('기존 본문을 편집하고 저장한 후 갱신한다', async () => {
    expect(document.querySelector('textarea')!.value).toBe('기존 본문')
    expect(button('min.form.save').disabled).toBe(true)
    await edit('수정된 본문')
    await act(async () => button('min.form.save').click())
    expect(save).toHaveBeenCalledWith('m1', '수정된 본문')
    expect(onSaved).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith({ title: 'min.body.saved' })
  })
  it.each(['rejected', 'network'])('저장 실패 시 입력을 유지하고 재시도한다: %s', async mode => {
    if (mode === 'network') save.mockRejectedValueOnce(new Error('offline'))
    else save.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    await edit('수정 초안')
    await act(async () => button('min.form.save').click())
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(document.querySelector('textarea')!.value).toBe('수정 초안')
    expect(onSaved).not.toHaveBeenCalled()
    await act(async () => button('min.form.save').click())
    expect(onSaved).toHaveBeenCalledOnce()
  })
  it('취소하면 저장하지 않는다', async () => {
    await edit('취소할 내용')
    await act(async () => button('common.cancel').click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })
  it('본문 길이 제한을 넘으면 저장을 막는다', async () => {
    await edit('a'.repeat(100001))
    expect(button('min.form.save').disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('min.body.tooLong')
    expect(save).not.toHaveBeenCalled()
  })
})
