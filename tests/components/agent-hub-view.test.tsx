// tests/components/agent-hub-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentHub } from '@/lib/domain/agentHub'
import type { ComputedItem } from '@/lib/domain/types'
import type { HubWbsBundle } from '@/components/agent-hub/AgentHubView'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn(), apply = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({ refreshAgentHub: (...a: unknown[]) => refresh(...(a as [])), applyHubDelegations: (...a: unknown[]) => apply(...(a as [])), runHubProcessOp: vi.fn() }))
vi.mock('@/app/actions/wbsSpec', () => ({ setAgentDelegation: vi.fn(), updateAgentPrompt: vi.fn() }))
vi.mock('@/app/actions/agentWork', () => ({ approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(), setAgentProjectEnabled: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/p/p1/agents' }))
// 실시간 구독(0098) — 채널은 스텁이고 broadcast 콜백만 붙잡아 테스트가 직접 쏜다.
const rt = vi.hoisted(() => ({ broadcast: null as ((m: { payload?: unknown }) => void) | null }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_t: string, _f: unknown, cb: (m: { payload?: unknown }) => void) => { rt.broadcast = cb; return channel },
      subscribe: () => channel,
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      realtime: { setAuth: vi.fn() },
      channel: () => channel,
      removeChannel: vi.fn(),
    }
  },
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
// 상세 패널은 WBS 편집 전체 표면(무거운 의존성)이라 스텁으로 대체 — 여기서는 "열림/닫힘·대상 항목"만 검증한다.
vi.mock('@/components/wbs/RowDetailPanel', () => ({
  RowDetailPanel: ({ item, onClose }: { item: { id: string; name: string; rolledActualPct?: number }; onClose: () => void }) => (
    <div data-detail-panel={item.id} data-detail-actual={item.rolledActualPct}>
      {item.name}<button data-detail-close onClick={onClose} />
    </div>
  ),
}))
import { AgentHubView } from '@/components/agent-hub/AgentHubView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const hub = (over: Partial<AgentHub> = {}): AgentHub => ({
  projectId: 'p1', projectName: 'mes-base', registered: true, enabled: true,
  counters: { delegated: 1, ready: 0, working: 1, waiting: 0, stuck: 0 }, watchers: [],
  rows: [{ itemId: 'a1', code: 'TSK-A-01', name: '리프1', depth: 0, parentId: null, isLeaf: true, milestone: false, assigneeName: '장', assigneeMine: true, canManage: false, delegated: true, devWorkflow: true, stage: 'im', stageLocked: true, order: { id: 'o1', status: 'claimed', state: 'ACTIVE', agent: 'hong', lastSignalAt: new Date(NOW - 1000).toISOString() }, prompt: null, canToggle: true, waitReason: null }],
  queue: [], fetchedAt: new Date(NOW).toISOString(), viewer: { isAdmin: false, memberIds: ['m1'] }, ...over,
})
// 상세 패널 데이터 — 스텁은 id·name 만 읽고, AgentHubView 는 일정 계산에 plannedStart/End·rolledActualPct 를 쓴다.
const citem = (over: Partial<ComputedItem> = {}): ComputedItem =>
  ({ id: 'a1', name: '리프1', children: [], plannedStart: null, plannedEnd: null, rolledActualPct: 0, ...over }) as unknown as ComputedItem
const wbs = (over: Partial<HubWbsBundle> = {}): HubWbsBundle =>
  ({ items: [citem()], dependencies: [], unresolvedDepends: {}, holidays: [], today: '2026-09-14', levelLabels: [], maxDepth: null, members: [], actorView: null, ...over })

let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); apply.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('AgentHubView', () => {
  it('상태 줄·표·큐가 그려지고 멤버 기본 필터는 mine, 관리자는 all', () => {
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    expect(host.querySelector('[data-hero-tile="working"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect(host.textContent).toContain('승인 대기 없음')
    expect((host.querySelector('[data-hub-filter="mine"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    // 기본 필터는 마운트 시점 초기값이라 새 루트로 다시 그린다.
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<AgentHubView initial={hub({ viewer: { isAdmin: true, memberIds: [] } })} wbs={wbs()} />))
    expect((host.querySelector('[data-hub-filter="all"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  })
  it('갱신 실패는 마지막 데이터를 유지하고 상단에 실패 시각·문구', async () => {
    refresh.mockResolvedValueOnce({ ok: false, error: '에이전트 현황 재조회에 실패했습니다.' })
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    await act(async () => { (host.querySelector('[data-hub-refresh]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect((host.querySelector('[data-hub-stamp]') as HTMLElement).textContent).toContain('갱신 실패')
    expect((host.querySelector('[data-hub-stamp]') as HTMLElement).textContent).toContain('재조회에 실패')
  })
  it('위임 체크 → 묶음 저장 응답의 허브로 교체하고 refreshAgentHub 는 부르지 않는다(2026-09-14 체크 지연 개선)', async () => {
    apply.mockResolvedValueOnce({ ok: true, hub: hub({ rows: [], counters: { delegated: 0, ready: 0, working: 0, waiting: 0, stuck: 0 } }), failed: [], warnings: [] })
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    const box = host.querySelector('[data-hub-row="a1"] input[data-hub-toggle]') as HTMLInputElement
    await act(async () => { box.click() })
    expect(box.checked).toBe(false); expect(box.disabled).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(apply).toHaveBeenCalledWith('p1', [{ itemId: 'a1', delegated: false }])
    expect(host.querySelector('[data-hub-row="a1"]')).toBeNull()
    expect(host.querySelector('[data-hero-tile="working"]')?.textContent).toBe('0')
    expect(refresh).not.toHaveBeenCalled()
  })
  it('갱신 성공은 새 데이터로 교체', async () => {
    refresh.mockResolvedValueOnce({ ok: true, hub: hub({ rows: [], counters: { delegated: 0, ready: 0, working: 0, waiting: 0, stuck: 0 } }) })
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    await act(async () => { (host.querySelector('[data-hub-refresh]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-hub-row="a1"]')).toBeNull()
    expect(refresh).toHaveBeenCalledWith('p1')
  })
  it('좌석 층 섹션이 없다 — 층은 /agents/office 가 그린다(오피스 분리 스펙 §6-2)', () => {
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    expect(host.querySelector('section[aria-label="좌석"]')).toBeNull()
    expect(host.querySelector('[data-panel]')).toBeNull()
  })
  it('이름을 누르면 그 항목의 WBS 상세 패널이 이 화면 위에 열리고, 닫으면 닫히며 허브를 1회 재조회한다(WBS 페이지 이동 없음)', async () => {
    refresh.mockResolvedValueOnce({ ok: true, hub: hub() }) // 닫을 때 표를 맞추는 재조회(패널 편집이 이름을 바꿨을 수 있다)
    act(() => root.render(<AgentHubView initial={hub()} wbs={wbs()} />))
    expect(host.querySelector('[data-detail-panel]')).toBeNull()
    await act(async () => { (host.querySelector('[data-hub-row="a1"] [data-hub-open="a1"]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-detail-panel="a1"]')).not.toBeNull()
    expect(host.querySelector('[data-detail-panel="a1"]')?.textContent).toContain('리프1')
    await act(async () => { (host.querySelector('[data-detail-close]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-detail-panel]')).toBeNull()
    expect(refresh).toHaveBeenCalledWith('p1')
  })
  it('실시간 신호를 받으면 허브를 재조회한다 — 연속 신호는 1회로 접는다', async () => {
    // 승인 대기 카드는 주문 상태·보고 본문·서브트리 관리자 판정으로 조립된다. 트리거 페이로드
    // {id, stage, actual_pct} 만으로는 **새 카드를 만들 수 없다** — 그래서 부분 패치가 아니라
    // 이미 있는 refreshAgentHub 1회로 추가·갱신·제거를 한꺼번에 덮는다(router.refresh 아님, §7).
    refresh.mockResolvedValue({ ok: true, hub: hub() })
    await act(async () => { root.render(<AgentHubView initial={hub()} wbs={wbs()} />) })
    expect(rt.broadcast).not.toBeNull()

    await act(async () => {
      for (let n = 1; n <= 5; n++) {
        rt.broadcast!({ payload: {
          id: `a${n}`, project_id: 'p1', stage: 'im', actual_pct: 80,
          updated_at: `2026-09-14T0${n}:00:00.000Z`,
        } })
        vi.advanceTimersByTime(200)
      }
    })
    expect(refresh).not.toHaveBeenCalled() // 마지막 신호로부터 아직 조용하지 않다

    await act(async () => { vi.advanceTimersByTime(8_000) }) // delay+maxWait+jitter 상한을 넘긴다
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('p1')
  })

  it('허브에서 연 상세 패널도 실시간으로 따라온다', async () => {
    // 이 화면의 상세 패널 데이터(wbs.items)는 서버 페이지가 실어 준 값이라 refreshAgentHub 로는
    // 갱신되지 않는다. 허브만 바뀌고 패널이 낡으면 같은 화면이 서로 다른 숫자를 보여준다.
    refresh.mockResolvedValue({ ok: true, hub: hub() })
    await act(async () => { root.render(<AgentHubView initial={hub()} wbs={wbs()} />) })
    await act(async () => { (host.querySelector('[data-hub-open="a1"]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-detail-panel="a1"]')?.getAttribute('data-detail-actual')).toBe('0')

    await act(async () => {
      rt.broadcast!({ payload: {
        id: 'a1', project_id: 'p1', stage: 'xx', actual_pct: 100,
        updated_at: '2026-09-14T10:00:00.000Z',
      } })
    })
    expect(host.querySelector('[data-detail-panel="a1"]')?.getAttribute('data-detail-actual')).toBe('100')
  })

  it('형태가 어긋난 실시간 페이로드는 재조회를 부르지 않는다', async () => {
    await act(async () => { root.render(<AgentHubView initial={hub()} wbs={wbs()} />) })
    await act(async () => { rt.broadcast!({ payload: { nope: true } }) })
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('허브 컴포넌트는 router.refresh 를 쓰지 않는다(스펙 §7)', () => {
    // §7 의 금지는 허브 자체 흐름(잦은 위임 토글이 WBS 전체를 다시 그리지 못하게 하는 성능 예산)에 대한 것이다.
    // 이 검사는 agent-hub 소유 컴포넌트만 훑는다. 이름 클릭으로 여는 RowDetailPanel 은 components/wbs 소속이라
    // 여기 걸리지 않으며, 그 패널은 명시적 WBS 편집 때만 router.refresh 를 부른다(§7 아래 "범위 밖"으로 인정된 계열).
    const dir = join(process.cwd(), 'src/components/agent-hub')
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toContain('router.refresh')
  })
})
