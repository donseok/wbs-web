// tests/components/agent-hub-queue.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentHub, HubQueueEntry } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const runOp = vi.fn(), setEnabled = vi.fn()
vi.mock('@/app/actions/agentHub', () => ({ runHubProcessOp: (...a: unknown[]) => runOp(...(a as [])) }))
vi.mock('@/app/actions/agentWork', () => ({ setAgentProjectEnabled: (...a: unknown[]) => setEnabled(...(a as [])) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { ApprovalQueue } from '@/components/agent-hub/ApprovalQueue'
import { HubStatusBar } from '@/components/agent-hub/HubStatusBar'

const Q: HubQueueEntry[] = [{ orderId: 'o1', itemId: 'i1', code: 'TSK-1', name: '화면', agent: 'hong/mbp', percent: 100, summary: '끝', links: [{ url: 'https://x/pr/1', label: 'PR' }], reportedAt: '2026-09-14T08:00:00Z', assigneeMine: false, canManage: false }]
const QMINE: HubQueueEntry[] = [{ ...Q[0], assigneeMine: true }]
/** 서브트리 관리자(트랙 B, 2026-09-15) — 리프 본인 담당자는 아니지만 조상 담당자가 나인 경우. */
const QMANAGE: HubQueueEntry[] = [{ ...Q[0], canManage: true }]
const HUB = { projectId: 'p1', queue: [] } as unknown as AgentHub

let host: HTMLDivElement, root: Root
beforeEach(() => { runOp.mockReset(); setEnabled.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const setValue = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
}
const render = (over: Partial<Parameters<typeof ApprovalQueue>[0]> = {}) => {
  const onHub = vi.fn(), onChanged = vi.fn()
  act(() => root.render(<ApprovalQueue queue={Q} projectId="p1" isAdmin onHub={onHub} onChanged={onChanged} {...over} />))
  return { onHub, onChanged }
}

describe('ApprovalQueue — 처리는 runHubProcessOp 1건, 응답의 허브로 교체(§11)', () => {
  it('비면 안내 한 줄', () => {
    render({ queue: [] })
    expect(host.textContent).toContain('승인 대기 없음')
  })
  it('카드에 코드·이름·에이전트·요약·링크가 보이고 승인 → {kind:approve} + onHub(hub), onChanged 없음', async () => {
    runOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    const { onHub, onChanged } = render()
    expect(host.textContent).toContain('TSK-1'); expect(host.textContent).toContain('hong/mbp'); expect(host.textContent).toContain('끝')
    expect((host.querySelector('a[href="https://x/pr/1"]') as HTMLAnchorElement).textContent).toContain('PR')
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'approve', orderId: 'o1' })
    expect(onHub).toHaveBeenCalledWith(HUB)
    expect(onChanged).not.toHaveBeenCalled()
  })
  it('반려는 사유가 비면 버튼 비활성, 채우면 {kind:reject, note}', async () => {
    runOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    render()
    await act(async () => { (host.querySelector('[data-queue-reject-open]') as HTMLButtonElement).click() })
    const btn = host.querySelector('[data-queue-reject]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await act(async () => { setValue(host.querySelector('textarea') as HTMLTextAreaElement, '다시') })
    expect(btn.disabled).toBe(false)
    await act(async () => { btn.click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'reject', orderId: 'o1', note: '다시' })
  })
  it('실패는 카드 안 오류 문구, warning 은 카드 안 경고 문구', async () => {
    runOp.mockResolvedValueOnce({ ok: false, error: '상태 아님' })
    render()
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect((host.querySelector('[data-queue-error]') as HTMLElement).textContent).toContain('상태 아님')
    runOp.mockResolvedValueOnce({ ok: true, hub: HUB, warning: '단계는 그대로' })
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-queue-error]')).toBeNull()
    expect((host.querySelector('[data-queue-warning]') as HTMLElement).textContent).toContain('단계는 그대로')
  })
  it('처리는 됐고 재조회만 실패(hub:null) → 문구 + onChanged 로 재시도', async () => {
    runOp.mockResolvedValueOnce({ ok: true, hub: null, hubError: '처리는 됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.' })
    const { onHub, onChanged } = render()
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect((host.querySelector('[data-queue-error]') as HTMLElement).textContent).toContain('재조회에 실패')
    expect(onHub).not.toHaveBeenCalled(); expect(onChanged).toHaveBeenCalledTimes(1)
  })
  it('내 담당 아닌 멤버에게는 버튼 대신 안내', () => {
    render({ isAdmin: false })
    expect(host.querySelector('[data-queue-approve]')).toBeNull()
    expect(host.querySelector('[data-queue-reject-open]')).toBeNull()
    expect(host.textContent).toContain('승인은 관리자가 합니다')
  })
  it('담당자 본인(assigneeMine) 멤버는 승인은 못 하고 반려만 — 자기 보고를 물릴 수 있다(2026-09-14 §11)', async () => {
    runOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    render({ isAdmin: false, queue: QMINE })
    expect(host.querySelector('[data-queue-approve]')).toBeNull()
    expect(host.querySelector('[data-queue-reject-open]')).not.toBeNull()
    expect(host.textContent).toContain('담당자는 반려로')
    await act(async () => { (host.querySelector('[data-queue-reject-open]') as HTMLButtonElement).click() })
    await act(async () => { setValue(host.querySelector('textarea') as HTMLTextAreaElement, '내가 다시 볼게요') })
    await act(async () => { (host.querySelector('[data-queue-reject]') as HTMLButtonElement).click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'reject', orderId: 'o1', note: '내가 다시 볼게요' })
  })
  it('서브트리 관리자(canManage, 트랙 B): 리프 본인 담당자가 아니어도 approve+reject 가 보이고 안내문은 없다', async () => {
    runOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    render({ isAdmin: false, queue: QMANAGE })
    expect(host.querySelector('[data-queue-approve]')).not.toBeNull()
    expect(host.querySelector('[data-queue-reject-open]')).not.toBeNull()
    expect(host.textContent).not.toContain('담당자는 반려로')
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect(runOp).toHaveBeenCalledWith('p1', { kind: 'approve', orderId: 'o1' })
  })
  it('관리자(대조군): 전부 보인다 — approve·reject 둘 다', () => {
    render({ isAdmin: true, queue: Q })
    expect(host.querySelector('[data-queue-approve]')).not.toBeNull()
    expect(host.querySelector('[data-queue-reject-open]')).not.toBeNull()
  })
})

describe('HubStatusBar', () => {
  const base = { projectId: 'p1', watchers: [], onChanged: () => {} }
  it('켜짐 배지와 감시자, 관리자에게 토글 — 카운터는 공통 헤더 타일로 올라갔다(2026-09-18)', () => {
    act(() => root.render(<HubStatusBar {...base} registered enabled isAdmin watchers={[{ agent: 'hong/mbp', host: 'mbp', slots: 2, busy: 1, untilLabel: '18:00', lastSeenAt: '2026-09-14T08:59:00Z', projectId: 'p1' }]} />))
    expect(host.querySelector('[data-hub-counter]')).toBeNull()
    expect(host.textContent).toContain('hong/mbp 1/2 ~18:00')
    expect(host.querySelector('button')).not.toBeNull()
    expect((host.querySelector('a[href="/account"]') as HTMLAnchorElement).textContent).toContain('내 토큰')
    expect(host.querySelector('[data-hub-seatmap-link]')).toBeNull() // 전체 스튜디오 링크는 스튜디오 탭으로 옮겼다
  })
  it('미등록이면 안내, 멤버에게는 토글 없음', () => {
    act(() => root.render(<HubStatusBar {...base} registered={false} enabled={false} isAdmin={false} />))
    expect(host.textContent).toContain('첫 위임 때 켜집니다')
    expect(host.querySelector('button')).toBeNull()
  })
  it('관리자 토글 성공 → onChanged 호출(router.refresh 대신)', async () => {
    setEnabled.mockResolvedValueOnce({ ok: true })
    const onChanged = vi.fn()
    act(() => root.render(<HubStatusBar {...base} registered enabled isAdmin onChanged={onChanged} />))
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click() })
    expect(setEnabled).toHaveBeenCalledWith('p1', false)
    expect(onChanged).toHaveBeenCalled()
  })
})
