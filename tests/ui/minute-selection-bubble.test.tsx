// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import {
  MinuteSelectionBubble, type MinuteSelectionTarget,
} from '@/components/minutes/MinuteSelectionBubble'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))

const BODY = '첫 번째 문단은 전송 누락 위험을 다룬다.\n\n두 번째 문단은 재처리 확인이 필요하다.'
const blocks = splitMinuteBlocks(BODY)
const HEADING_BODY = '# 제목뿐인 회의록'
const headingBlocks = splitMinuteBlocks(HEADING_BODY)

const RECT = {
  top: 100, bottom: 120, left: 40, right: 240, width: 200, height: 20, x: 40, y: 100,
  toJSON: () => ({}),
} as DOMRect

let container: HTMLDivElement
let root: Root

function mount(ui: React.ReactElement) {
  act(() => root.render(ui))
}

function selectAcross(el1: Node, off1: number, el2: Node, off2: number) {
  const range = document.createRange()
  range.setStart(el1, off1)
  range.setEnd(el2, off2)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function fireSelectionDone() {
  act(() => { document.dispatchEvent(new Event('pointerup')) })
}

type RectCarrier = { getBoundingClientRect?: () => DOMRect }

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom 의 Range 에는 레이아웃 API 가 없다 — 프로토타입에 직접 주입한다.
  ;(Range.prototype as RectCarrier).getBoundingClientRect = () => RECT
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
  delete (Range.prototype as RectCarrier).getBoundingClientRect
  vi.restoreAllMocks()
})

function renderWithBody(opts: {
  blocks?: typeof blocks
  bodyHtml?: string
  disabled?: boolean
  onCreateIssue?: (target: MinuteSelectionTarget) => void
} = {}) {
  const bodyRef = createRef<HTMLDivElement>()
  const onCreateIssue = opts.onCreateIssue ?? vi.fn()
  mount(
    <>
      <div
        ref={bodyRef}
        dangerouslySetInnerHTML={{
          __html: opts.bodyHtml
            ?? '<p data-mblock="0">첫 번째 문단은 전송 누락 위험을 다룬다.</p>'
              + '<p data-mblock="1">두 번째 문단은 재처리 확인이 필요하다.</p>',
        }}
      />
      <MinuteSelectionBubble
        bodyRef={bodyRef}
        blocks={opts.blocks ?? blocks}
        disabled={opts.disabled ?? false}
        busy={false}
        onCreateIssue={onCreateIssue}
      />
    </>,
  )
  return { bodyRef, onCreateIssue }
}

describe('MinuteSelectionBubble', () => {
  it('두 블록에 걸친 선택 후 pointerup 에 버블이 뜨고 target 을 전달한다', () => {
    const onCreateIssue = vi.fn()
    const { bodyRef } = renderWithBody({ onCreateIssue })
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 8, p1.firstChild!, 12)
    fireSelectionDone()

    const button = document.querySelector('button')
    expect(button?.textContent).toContain('min.sel.create')
    act(() => { button!.click() })
    expect(onCreateIssue).toHaveBeenCalledTimes(1)
    const target = onCreateIssue.mock.calls[0][0] as MinuteSelectionTarget
    expect(target.startIndex).toBe(0)
    expect(target.endIndex).toBe(1)
    expect(target.startHash).toBe(blocks[0].hash)
    expect(target.endHash).toBe(blocks[1].hash)
    expect(target.text.replace(/\s+/g, '')).toBe(
      '전송 누락 위험을 다룬다.두 번째 문단은 재처리'.replace(/\s+/g, ''),
    )
    // 발췌는 클라 선택 문자열이 아니라 서버 대조 함수가 원문에서 재구성한 값이다.
    expect(target.excerpt).toBe('전송 누락 위험을 다룬다.\n두 번째 문단은 재처리')
  })

  it('트리플클릭형 끝 앵커(다음 블록 offset 0)는 실제 기여 블록으로 클램프한다', () => {
    const onCreateIssue = vi.fn()
    const { bodyRef } = renderWithBody({ onCreateIssue })
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    // Chrome 트리플클릭·문단 끝 넘김 드래그 재현 — 끝 앵커가 다음 블록 요소의 offset 0.
    selectAcross(p0.firstChild!, 0, p1, 0)
    fireSelectionDone()

    const button = document.querySelector('button')
    expect(button).not.toBeNull()
    act(() => { button!.click() })
    const target = onCreateIssue.mock.calls[0][0] as MinuteSelectionTarget
    expect(target.startIndex).toBe(0)
    expect(target.endIndex).toBe(0)
    expect(target.endHash).toBe(blocks[0].hash)
    expect(target.excerpt).toBe('첫 번째 문단은 전송 누락 위험을 다룬다.')
  })

  it('원문과 대조되지 않는 선택(렌더 전용 텍스트)은 버블을 띄우지 않는다', () => {
    // blocks 는 실제 본문이지만 DOM 에 다른 텍스트가 렌더된 상황(머메이드·이미지 alt 등) 재현.
    const { bodyRef } = renderWithBody({
      bodyHtml: '<p data-mblock="0">렌더 전용 다이어그램 캡션 텍스트</p>'
        + '<p data-mblock="1">두 번째 문단은 재처리 확인이 필요하다.</p>',
    })
    const p0 = bodyRef.current!.querySelector('p')!
    selectAcross(p0.firstChild!, 0, p0.firstChild!, 10)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('바깥 pointerdown 으로 표출 중이던 버블이 사라질 때 onDismiss 를 호출한다', () => {
    const onDismiss = vi.fn()
    const bodyRef = createRef<HTMLDivElement>()
    mount(
      <>
        <div
          ref={bodyRef}
          dangerouslySetInnerHTML={{
            __html: '<p data-mblock="0">첫 번째 문단은 전송 누락 위험을 다룬다.</p>'
              + '<p data-mblock="1">두 번째 문단은 재처리 확인이 필요하다.</p>',
          }}
        />
        <MinuteSelectionBubble
          bodyRef={bodyRef}
          blocks={blocks}
          disabled={false}
          busy={false}
          onCreateIssue={vi.fn()}
          onDismiss={onDismiss}
        />
      </>,
    )
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 0, p1.firstChild!, 12)
    fireSelectionDone()
    expect(document.querySelector('button')).not.toBeNull()
    act(() => { document.dispatchEvent(new Event('pointerdown')) })
    expect(document.querySelector('button')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('공백 제거 5자 미만 선택은 버블을 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody()
    const p0 = bodyRef.current!.querySelector('p')!
    selectAcross(p0.firstChild!, 0, p0.firstChild!, 3)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('본문 밖 선택은 무시한다', () => {
    renderWithBody()
    const outside = document.createElement('p')
    outside.textContent = '본문 밖 텍스트입니다 다섯 글자 이상'
    document.body.appendChild(outside)
    selectAcross(outside.firstChild!, 0, outside.firstChild!, 10)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
    outside.remove()
  })

  it('heading 뿐인 선택은 버블을 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody({
      blocks: headingBlocks,
      bodyHtml: '<h1 data-mblock="0">제목뿐인 회의록</h1>',
    })
    const h1 = bodyRef.current!.querySelector('h1')!
    selectAcross(h1.firstChild!, 0, h1.firstChild!, 8)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('disabled 면 아무것도 띄우지 않는다', () => {
    const { bodyRef } = renderWithBody({ disabled: true })
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 0, p1.firstChild!, 12)
    fireSelectionDone()
    expect(document.querySelector('button')).toBeNull()
  })

  it('선택이 해제되면 버블이 사라진다', () => {
    const { bodyRef } = renderWithBody()
    const [p0, p1] = Array.from(bodyRef.current!.querySelectorAll('p'))
    selectAcross(p0.firstChild!, 0, p1.firstChild!, 12)
    fireSelectionDone()
    expect(document.querySelector('button')).not.toBeNull()
    act(() => {
      window.getSelection()!.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(document.querySelector('button')).toBeNull()
  })
})
