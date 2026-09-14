// tests/components/agent-hub-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentHub } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const refresh = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({ refreshAgentHub: (...a: unknown[]) => refresh(...(a as [])), setAgentDelegationBulk: vi.fn() }))
vi.mock('@/app/actions/wbsSpec', () => ({ setAgentDelegation: vi.fn(), updateAgentPrompt: vi.fn() }))
vi.mock('@/app/actions/agentWork', () => ({ approveAgentCompletion: vi.fn(), rejectAgentCompletion: vi.fn(), setAgentProjectEnabled: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { AgentHubView } from '@/components/agent-hub/AgentHubView'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const hub = (over: Partial<AgentHub> = {}): AgentHub => ({
  projectId: 'p1', projectName: 'mes-base', registered: true, enabled: true,
  counters: { delegated: 1, ready: 0, working: 1, waiting: 0 }, watchers: [],
  rows: [{ itemId: 'a1', code: 'TSK-A-01', name: '리프1', depth: 0, parentId: null, isLeaf: true, milestone: false, assigneeName: '장', assigneeMine: true, delegated: true, devWorkflow: true, order: { id: 'o1', status: 'claimed', state: 'ACTIVE', agent: 'hong', lastSignalAt: new Date(NOW - 1000).toISOString() }, prompt: null, canToggle: true }],
  queue: [], fetchedAt: new Date(NOW).toISOString(), viewer: { isAdmin: false, memberIds: ['m1'] }, ...over,
})

let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); refresh.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('AgentHubView', () => {
  it('상태 줄·표·큐·층 자리가 그려지고 멤버 기본 필터는 mine, 관리자는 all', () => {
    act(() => root.render(<AgentHubView initial={hub()} />))
    expect(host.querySelector('[data-hub-counter="working"]')?.textContent).toBe('1')
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect(host.textContent).toContain('승인 대기 없음')
    expect((host.querySelector('[data-hub-filter="mine"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    // 기본 필터는 마운트 시점 초기값이라 새 루트로 다시 그린다.
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<AgentHubView initial={hub({ viewer: { isAdmin: true, memberIds: [] } })} />))
    expect((host.querySelector('[data-hub-filter="all"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  })
  it('갱신 실패는 마지막 데이터를 유지하고 상단에 실패 시각·문구', async () => {
    refresh.mockResolvedValueOnce({ ok: false, error: '에이전트 현황 재조회에 실패했습니다.' })
    act(() => root.render(<AgentHubView initial={hub()} />))
    await act(async () => { (host.querySelector('[data-hub-refresh]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect((host.querySelector('[data-hub-stamp]') as HTMLElement).textContent).toContain('갱신 실패')
    expect((host.querySelector('[data-hub-stamp]') as HTMLElement).textContent).toContain('재조회에 실패')
  })
  it('갱신 성공은 새 데이터로 교체', async () => {
    refresh.mockResolvedValueOnce({ ok: true, hub: hub({ rows: [], counters: { delegated: 0, ready: 0, working: 0, waiting: 0 } }) })
    act(() => root.render(<AgentHubView initial={hub()} />))
    await act(async () => { (host.querySelector('[data-hub-refresh]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-hub-row="a1"]')).toBeNull()
    expect(refresh).toHaveBeenCalledWith('p1')
  })
  it('좌석 층 섹션이 없다 — 층은 /agents/office 가 그린다(오피스 분리 스펙 §6-2)', () => {
    act(() => root.render(<AgentHubView initial={hub()} />))
    expect(host.querySelector('section[aria-label="좌석"]')).toBeNull()
    expect(host.querySelector('[data-panel]')).toBeNull()
  })
  it('허브 컴포넌트는 router.refresh 를 쓰지 않는다(스펙 §7)', () => {
    const dir = join(process.cwd(), 'src/components/agent-hub')
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toContain('router.refresh')
  })
})
