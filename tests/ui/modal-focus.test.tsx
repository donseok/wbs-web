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

/** autoFocus 자식을 가진 실제 소비자 패턴(NewProjectModal 등) + 트리거 버튼. */
function AutoFocusHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>열기</button>
      <Modal open={open} onClose={() => setOpen(false)} title="새 항목">
        <input data-testid="name" autoFocus />
      </Modal>
    </>
  )
}

/** 상호배타 2-모달 연쇄(근태 편집→삭제확인, 공지 읽기→편집 패턴) — 한 커밋에서 A 닫힘+B 열림. */
function ChainHarness() {
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <>
      <button data-testid="trigger" onClick={() => setEditOpen(true)}>열기</button>
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="편집">
        <button data-testid="to-confirm" onClick={() => { setEditOpen(false); setConfirmOpen(true) }}>삭제</button>
      </Modal>
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="삭제 확인">
        <button data-testid="confirm-close" onClick={() => setConfirmOpen(false)}>정말 삭제</button>
        <button data-testid="back-to-edit" onClick={() => { setConfirmOpen(false); setEditOpen(true) }}>취소</button>
      </Modal>
    </>
  )
}

/** onClose가 변하는 상태(value)를 클로저로 캡처하는 패턴 — stale closure 회귀 감지용. */
function StaleClosureHarness({ record }: { record: (v: string) => void }) {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('')
  return (
    <Modal open={open} onClose={() => { record(value); setOpen(false) }} title="편집">
      <input data-testid="name" value={value} onChange={e => setValue(e.target.value)} />
    </Modal>
  )
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

  it('Escape의 onClose는 리렌더 이후의 최신 상태를 본다 (stale closure 방어)', () => {
    let recorded: string | null = null
    root = createRoot(container)
    act(() => root.render(<StaleClosureHarness record={v => { recorded = v }} />))

    const input = document.querySelector<HTMLInputElement>('[data-testid="name"]')!
    act(() => input.focus())
    act(() => typeChar(input, 'D'))
    act(() => typeChar(input, 'DK'))

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(recorded).toBe('DK')
  })

  it('autoFocus 자식이 있으면 트랩이 포커스를 빼앗지 않고, 닫을 때 트리거로 복원한다', () => {
    root = createRoot(container)
    act(() => root.render(<AutoFocusHarness />))

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!
    act(() => trigger.focus())
    act(() => trigger.click())

    // 열림: autoFocus 입력이 포커스를 유지해야 함 (트랩의 초기 포커스가 덮어쓰지 않음).
    const input = document.querySelector<HTMLInputElement>('[data-testid="name"]')!
    expect(document.activeElement).toBe(input)

    // 닫힘: autoFocus 때문에 이전 포커스 캡처가 오염됐더라도 트리거로 복원돼야 함.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('연쇄 모달(편집→삭제확인→모두 닫힘)에서도 원래 트리거로 포커스가 복원된다', () => {
    root = createRoot(container)
    act(() => root.render(<ChainHarness />))

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!
    act(() => trigger.focus())
    act(() => trigger.click())

    const toConfirm = document.querySelector<HTMLButtonElement>('[data-testid="to-confirm"]')!
    act(() => toConfirm.focus())
    // 한 커밋에서 편집 모달 닫힘 + 확인 모달 열림 — 이 순간 activeElement는 곧 detach될 버튼.
    act(() => toConfirm.click())

    const confirmClose = document.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')!
    act(() => confirmClose.click())

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('연쇄 모달에서 취소로 앞 모달에 복귀 후 닫아도 트리거로 복원된다', () => {
    root = createRoot(container)
    act(() => root.render(<ChainHarness />))

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!
    act(() => trigger.focus())
    act(() => trigger.click())

    const toConfirm = document.querySelector<HTMLButtonElement>('[data-testid="to-confirm"]')!
    act(() => toConfirm.focus())
    act(() => toConfirm.click())

    const backToEdit = document.querySelector<HTMLButtonElement>('[data-testid="back-to-edit"]')!
    act(() => backToEdit.focus())
    act(() => backToEdit.click())

    // 편집 모달로 복귀한 뒤 Escape로 닫기 — 최종적으로 원래 트리거에 포커스.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('포커스가 트랩 밖으로 떨어져도 Tab이 다이얼로그 안으로 되돌린다', () => {
    root = createRoot(container)
    act(() => root.render(<Harness />))

    const input = document.querySelector<HTMLInputElement>('[data-testid="name"]')!
    act(() => input.focus())
    // 저장 중 버튼 disabled 전환 등으로 포커스가 body로 떨어진 상황 재현.
    act(() => input.blur())
    expect(document.activeElement).toBe(document.body)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
