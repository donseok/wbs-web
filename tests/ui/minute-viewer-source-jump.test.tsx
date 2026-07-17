// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  scrollIntoView: vi.fn(),
  frames: new Map<number, FrameRequestCallback>(),
  frameSeq: 0,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/components/minutes/MarkdownView', () => ({
  MarkdownView: () => (
    <>
      <h1 data-mblock="0">제목</h1>
      <p data-mblock="1">결정: REST 방식 확정</p>
      <p data-mblock="2">추가 내용</p>
    </>
  ),
}))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const bodyMd = '# 제목\n\n결정: REST 방식 확정\n\n추가 내용'
const blocks = splitMinuteBlocks(bodyMd)
const bodyHash = fnv1a64(bodyMd)
const minute: Minute = {
  id: 'm1', minuteDate: '2026-07-16', teamCode: 'PMO', title: '주간회의',
  bodyMd, meetingId: null, createdBy: 'u1', createdByName: '작성자',
  createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z',
}

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

describe('MinuteViewer 원문 최초 점프', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.toast.mockClear()
    mocks.scrollIntoView.mockClear()
    mocks.frames.clear()
    mocks.frameSeq = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++mocks.frameSeq
      mocks.frames.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { mocks.frames.delete(id) })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: mocks.scrollIntoView,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(sourceAnchor: { blockIndex: number; blockHash: string; bodyHash: string }) {
    await act(async () => root.render(
      <StrictMode>
        <MinuteViewer
          minute={minute} files={[]} canManage={false}
          annotations={{ highlights: [], insights: [] }} commitments={[]}
          userId="u1" projects={[]}
          sourceAnchor={sourceAnchor}
        />
      </StrictMode>,
    ))
    await act(async () => {
      const pending = [...mocks.frames.values()]
      mocks.frames.clear()
      pending.forEach(cb => cb(0))
    })
  }

  it('Strict Mode에서도 해당 블록으로 한 번만 스크롤하고 강조한다', async () => {
    await render({ blockIndex: 1, blockHash: blocks[1].hash, bodyHash })

    expect(mocks.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(container.querySelector('[data-mblock="1"]')?.classList.contains('mblock-flash')).toBe(true)
    expect(document.activeElement).toBe(container.querySelector('[data-mblock="1"]'))
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('원문 해시를 찾지 못하면 오점프하지 않고 안내한다', async () => {
    await render({ blockIndex: 1, blockHash: 'ffffffffffffffff', bodyHash })

    expect(mocks.scrollIntoView).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'min.source.missing', variant: 'info' })
  })

  it('stale 본문 앵커가 같은 화면에서 유효한 앵커로 갱신되면 다시 판정해 점프한다', async () => {
    await render({ blockIndex: 1, blockHash: blocks[1].hash, bodyHash: 'ffffffffffffffff' })
    expect(mocks.scrollIntoView).not.toHaveBeenCalled()

    await render({ blockIndex: 1, blockHash: blocks[1].hash, bodyHash })
    expect(mocks.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(container.querySelector('[data-mblock="1"]'))
  })
})
