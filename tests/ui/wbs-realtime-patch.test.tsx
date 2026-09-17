// @vitest-environment jsdom
// WBS 트리의 실시간 부분 패치 — 행 하나를 갈아끼우고 **조상 롤업까지 다시 낸다.**
// 리프만 고치면 공정율·달성률·상태가 낡은 채 남아 화면이 조용히 틀린 숫자를 보여준다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type BroadcastCb = (msg: { payload?: unknown }) => void
type SubscribeCb = (status: string) => void

const h = vi.hoisted(() => ({
  broadcast: null as BroadcastCb | null,
  subscribe: null as SubscribeCb | null,
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: h.refresh }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_t: string, _f: unknown, cb: BroadcastCb) => { h.broadcast = cb; return channel },
      subscribe: (cb: SubscribeCb) => { h.subscribe = cb; return channel },
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      realtime: { setAuth: vi.fn() },
      channel: () => channel,
      removeChannel: vi.fn(),
    }
  },
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: vi.fn(), queueWbsCollapse: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('@/components/app/usePagePresence', () => ({ usePagePresence: () => [] }))
vi.mock('@/components/report/ReportModal', () => ({ ReportModal: () => null }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))

import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { computeTree } from '@/lib/domain/rollup'
import { DEFAULT_TEAM_CODES, teamOrderMap } from '@/lib/domain/teams'
import type { WbsRow } from '@/lib/domain/types'

const TODAY = '2026-09-17'
const row = (id: string, parentId: string | null, actualPct: number | null, updatedAt?: string): WbsRow => ({
  id, parentId, code: id, sortOrder: 1, name: id,
  biz: null, deliverable: null, plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
  weight: null, actualPct, owners: [], isOwnerSplit: false, stage: 'ip', updatedAt,
})

const tree = () => computeTree(
  [
    row('P', null, null),
    row('a', 'P', 0, '2026-09-17T01:00:00.000Z'),
    row('b', 'P', 0, '2026-09-17T01:00:00.000Z'),
  ],
  TODAY, new Set(), { subActTeamOrder: teamOrderMap(DEFAULT_TEAM_CODES) },
)

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  h.broadcast = null
  h.subscribe = null
  h.refresh.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount() {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="ko">
        <WbsGanttSheet
          items={tree()} holidays={[]} today={TODAY} actorView={null}
          projectId="a1b2c3d4-0000-4000-8000-000000000001" readOnly initialCollapsed={[]}
        />
      </LocaleProvider>,
    )
  })
}

const actualOf = (id: string) =>
  host.querySelector(`[data-row-id="${id}"] [data-wbs-col="pactual"]`)?.textContent ?? ''

const send = (over: Record<string, unknown>) => act(async () => {
  h.broadcast!({ payload: {
    project_id: 'a1b2c3d4-0000-4000-8000-000000000001',
    stage: 'xx', actual_pct: 100, updated_at: '2026-09-17T05:00:00.000Z', ...over,
  } })
})

describe('WbsGanttSheet — 실시간 부분 패치', () => {
  it('구독을 건다', async () => {
    await mount()
    expect(h.broadcast).not.toBeNull()
  })

  it('리프가 바뀌면 그 행과 조상 롤업이 함께 갱신된다', async () => {
    await mount()
    expect(actualOf('a')).toContain('0')
    expect(actualOf('P')).not.toContain('50')

    await send({ id: 'a' })

    expect(actualOf('a')).toContain('100')
    // 리프 둘(100, 0)의 균등 평균 — 조상이 낡은 채 남으면 여기서 실패한다.
    expect(actualOf('P')).toContain('50')
  })

  it('보유 행보다 오래된 페이로드는 화면을 바꾸지 않는다', async () => {
    await mount()
    await send({ id: 'a', updated_at: '2026-09-17T00:00:00.000Z' }) // 보유(01:00)보다 과거
    expect(actualOf('a')).not.toContain('100')
  })

  it('트리에 없는 항목은 무시한다', async () => {
    await mount()
    await send({ id: 'zzz' })
    expect(actualOf('a')).not.toContain('100')
  })

  it('재연결에서만 재조회한다 — 최초 구독은 부르지 않는다', async () => {
    await mount()
    await act(async () => { h.subscribe!('SUBSCRIBED') })
    expect(h.refresh).not.toHaveBeenCalled()
    await act(async () => { h.subscribe!('SUBSCRIBED') })
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})
