// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Modal } from '@/components/ui/Modal'

// react-dom/client의 act를 쓰려면 필요한 플래그.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** 실제 소비자 패턴 재현: 인라인 onClose(렌더마다 새 함수) + 제어 입력. */
function Harness({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('')
  return (
    <Modal open={open} onClose={() => { setOpen(false); onClosed?.() }} title="편집">
      <input
        data-testid="name"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
    </Modal>
  )
}

function typeChar(input: HTMLInputElement, next: string) {
  // React의 제어 입력에 네이티브 setter로 값 주입 후 input 이벤트 발생 → onChange 트리거.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Modal 포커스 트랩', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('입력 중 리렌더가 일어나도 포커스가 입력 필드에 남는다', () => {
    root = createRoot(container)
    act(() => root.render(<Harness />))

    const input = document.querySelector<HTMLInputElement>('[data-testid="name"]')!
    act(() => input.focus())
    expect(document.activeElement).toBe(input)

    // 한 글자 입력 → setState → 부모 리렌더 → 인라인 onClose가 새 identity가 됨.
    act(() => typeChar(input, 'D'))
    expect(document.activeElement).toBe(input)

    act(() => typeChar(input, 'D-'))
    expect(document.activeElement).toBe(input)
  })

  it('리렌더 후에도 Escape가 최신 onClose를 호출해 닫힌다', () => {
    let closed = false
    root = createRoot(container)
    act(() => root.render(<Harness onClosed={() => { closed = true }} />))

    const input = document.querySelector<HTMLInputElement>('[data-testid="name"]')!
    act(() => input.focus())
    act(() => typeChar(input, 'D'))

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
