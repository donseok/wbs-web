// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WikiSearch } from '@/components/wiki/WikiSearch'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 결과를 훑는 동안 질의를 고쳐 다시 던지는 게 이 화면의 주 동선인데, 종전엔 검색창이
// 결과와 함께 위로 밀려나 매번 맨 위로 되돌아가야 했다. 검색을 실행하면 히어로(제목·설명·칩)를
// 접고 입력줄만 스크롤 영역 상단에 sticky 로 붙인다. 검색 전에는 종전 히어로 그대로다.
describe('WikiSearch — 검색 후 압축 고정 바', () => {
  let container: HTMLDivElement
  let root: Root
  const fetchMock = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(Response.json({ results: [], degraded: false }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(initialQuery: string, adminSlot?: React.ReactNode) {
    await act(async () => {
      root.render(
        <WikiSearch projectId="proj-1" locale="ko" initialQuery={initialQuery} adminSlot={adminSlot} />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  const stickyBar = () => container.querySelector('.sticky.top-0')

  it('검색 전에는 히어로(제목·설명·칩)를 그대로 두고 고정 바를 만들지 않는다', async () => {
    await render('')
    expect(stickyBar()).toBeNull()
    expect(container.querySelector('#wiki-search-title')).not.toBeNull()
  })

  it('검색을 실행하면 히어로를 접고 입력줄을 상단에 고정한다', async () => {
    await render('보세공장')
    const bar = stickyBar()
    expect(bar).not.toBeNull()
    // 접혔으므로 제목은 사라지고, 입력창은 고정 바 안에 남는다.
    expect(container.querySelector('#wiki-search-title')).toBeNull()
    expect(bar?.querySelector('input[type="search"]')).not.toBeNull()
  })

  it('접힌 뒤에도 검색어가 입력창에 남는다 — 고쳐서 다시 던지는 동선이 이 고정의 목적이다', async () => {
    await render('보세공장')
    const input = stickyBar()?.querySelector('input[type="search"]') as HTMLInputElement | null
    expect(input?.value).toBe('보세공장')
  })

  // 고정 바의 배경(bg-canvas/85)이 없으면 아래로 지나가는 결과가 비쳐 글자가 겹쳐 보인다.
  it('고정 바는 배경과 z-index 를 갖는다 — 결과가 뒤로 지나가도 비치지 않게', async () => {
    await render('보세공장')
    const cls = stickyBar()?.className ?? ''
    expect(cls).toContain('bg-canvas')
    expect(cls).toContain('z-30')
  })

  it('입력을 비우면 히어로로 되돌아간다 — 압축 바에 갇히지 않게', async () => {
    await render('보세공장')
    const input = stickyBar()?.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      // 네이티브 × 를 누른 것과 같은 경로 — value 만 비우고 change 를 쏜다.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(stickyBar()).toBeNull()
    expect(container.querySelector('#wiki-search-title')).not.toBeNull()
  })

  it('색인 갱신 스트립은 접힌 바에서도 유지된다(넓은 폭 전용)', async () => {
    await render('보세공장', <button data-testid="reindex">색인 갱신</button>)
    expect(stickyBar()?.querySelector('[data-testid="reindex"]')).not.toBeNull()
  })
})
