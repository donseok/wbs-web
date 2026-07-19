// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  BotPageContextProvider,
  useBotPageContext,
  useCurrentBotPageContext,
} from '@/components/chat/BotPageContextProvider'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/12345678-1234-1234-1234-123456789abc/weekly',
  useSearchParams: () => new URLSearchParams('week=2026-07-13&team=ERP&team=PI&q=interface'),
}))

function Capture() {
  useBotPageContext({
    selectedEntity: { type: 'weekly_row', id: 'row-7' },
    filters: { status: 'issue' },
  })
  const context = useCurrentBotPageContext()
  return <pre data-context>{JSON.stringify(context)}</pre>
}

function RegistrationOnly() {
  useBotPageContext({ domain: 'wbs', projectId: 'p1' })
  return <div data-standalone>menu</div>
}

// M-10 렌더 카운터 — 등록 컴포넌트는 값 context를 구독하지 않아야 한다.
let registeringRenders = 0
function RegisteringMenu({ status }: { status: string }) {
  registeringRenders += 1
  useBotPageContext({ filters: { status } })
  return <div data-menu>{status}</div>
}

function ValueConsumer() {
  const context = useCurrentBotPageContext()
  return <pre data-value>{JSON.stringify(context.filters ?? null)}</pre>
}

function ClearUrlFilters() {
  useBotPageContext({ filters: {} })
  const context = useCurrentBotPageContext()
  return <pre data-cleared>{JSON.stringify(context)}</pre>
}

describe('BotPageContextProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('URL 문맥을 추론하고 화면이 등록한 선택·필터를 병합한다', async () => {
    await act(async () => {
      root.render(<BotPageContextProvider><Capture /></BotPageContextProvider>)
      await Promise.resolve()
    })

    const context = JSON.parse(container.querySelector('[data-context]')!.textContent!)
    expect(context).toMatchObject({
      contextVersion: 1,
      pathname: '/p/12345678-1234-1234-1234-123456789abc/weekly',
      domain: 'weekly',
      projectId: '12345678-1234-1234-1234-123456789abc',
      weekStart: '2026-07-13',
      search: 'interface',
      selectedEntity: { type: 'weekly_row', id: 'row-7' },
      filters: { status: 'issue' },
      timezone: 'Asia/Seoul',
    })
  })

  it('화면의 전체 선택은 URL에 남은 필터를 제거한다', async () => {
    await act(async () => {
      root.render(<BotPageContextProvider><ClearUrlFilters /></BotPageContextProvider>)
      await Promise.resolve()
    })
    const context = JSON.parse(container.querySelector('[data-cleared]')!.textContent!)
    expect(context).not.toHaveProperty('filters')
  })

  it('등록 컴포넌트는 자신의 등록 갱신으로 추가 렌더되지 않는다', async () => {
    registeringRenders = 0
    await act(async () => {
      root.render(
        <BotPageContextProvider>
          <RegisteringMenu status="issue" />
          <ValueConsumer />
        </BotPageContextProvider>,
      )
      await Promise.resolve()
    })
    // 마운트 1회뿐 — 등록 effect가 pageContext를 갱신해도 등록 훅은 값 context 미구독.
    expect(registeringRenders).toBe(1)
    expect(JSON.parse(container.querySelector('[data-value]')!.textContent!)).toMatchObject({ status: 'issue' })

    await act(async () => {
      root.render(
        <BotPageContextProvider>
          <RegisteringMenu status="done" />
          <ValueConsumer />
        </BotPageContextProvider>,
      )
      await Promise.resolve()
    })
    // 자기 prop 변경 렌더 1회만 추가 — 재등록이 유발한 값 갱신으로는 재렌더되지 않는다.
    expect(registeringRenders).toBe(2)
    expect(JSON.parse(container.querySelector('[data-value]')!.textContent!)).toMatchObject({ status: 'done' })
  })

  it('메뉴가 provider 없이 독립 렌더돼도 등록 훅은 무해하다', async () => {
    await act(async () => {
      root.render(<RegistrationOnly />)
      await Promise.resolve()
    })
    expect(container.querySelector('[data-standalone]')?.textContent).toBe('menu')
  })
})
