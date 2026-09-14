// tests/components/agent-hub-queue.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { HubQueueEntry } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const approve = vi.fn(), reject = vi.fn(), setEnabled = vi.fn()
vi.mock('@/app/actions/agentWork', () => ({
  approveAgentCompletion: (...a: unknown[]) => approve(...(a as [])), rejectAgentCompletion: (...a: unknown[]) => reject(...(a as [])),
  setAgentProjectEnabled: (...a: unknown[]) => setEnabled(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { ApprovalQueue } from '@/components/agent-hub/ApprovalQueue'
import { HubStatusBar } from '@/components/agent-hub/HubStatusBar'

const Q: HubQueueEntry[] = [{ orderId: 'o1', itemId: 'i1', code: 'TSK-1', name: '화면', agent: 'hong/mbp', percent: 100, summary: '끝', links: [{ url: 'https://x/pr/1', label: 'PR' }], reportedAt: '2026-09-14T08:00:00Z' }]

let host: HTMLDivElement, root: Root
beforeEach(() => { approve.mockReset(); reject.mockReset(); setEnabled.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const setValue = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ApprovalQueue', () => {
  it('비면 안내 한 줄', () => {
    act(() => root.render(<ApprovalQueue queue={[]} isAdmin onChanged={() => {}} />))
    expect(host.textContent).toContain('승인 대기 없음')
  })
  it('카드에 코드·이름·에이전트·요약·링크가 보이고 승인 → approveAgentCompletion + onChanged', async () => {
    approve.mockResolvedValueOnce({ ok: true })
    const onChanged = vi.fn()
    act(() => root.render(<ApprovalQueue queue={Q} isAdmin onChanged={onChanged} />))
    expect(host.textContent).toContain('TSK-1'); expect(host.textContent).toContain('hong/mbp'); expect(host.textContent).toContain('끝')
    expect((host.querySelector('a[href="https://x/pr/1"]') as HTMLAnchorElement).textContent).toContain('PR')
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect(approve).toHaveBeenCalledWith('o1'); expect(onChanged).toHaveBeenCalled()
  })
  it('반려는 사유가 비면 버튼 비활성, 채우면 rejectAgentCompletion(orderId, note)', async () => {
    reject.mockResolvedValueOnce({ ok: true })
    act(() => root.render(<ApprovalQueue queue={Q} isAdmin onChanged={() => {}} />))
    await act(async () => { (host.querySelector('[data-queue-reject-open]') as HTMLButtonElement).click() })
    const btn = host.querySelector('[data-queue-reject]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await act(async () => { setValue(host.querySelector('textarea') as HTMLTextAreaElement, '다시') })
    expect(btn.disabled).toBe(false)
    await act(async () => { btn.click() })
    expect(reject).toHaveBeenCalledWith('o1', '다시')
  })
  it('실패는 카드 안 오류 문구', async () => {
    approve.mockResolvedValueOnce({ ok: false, error: '상태 아님' })
    act(() => root.render(<ApprovalQueue queue={Q} isAdmin onChanged={() => {}} />))
    await act(async () => { (host.querySelector('[data-queue-approve]') as HTMLButtonElement).click() })
    expect((host.querySelector('[data-queue-error]') as HTMLElement).textContent).toContain('상태 아님')
  })
  it('멤버에게는 버튼 대신 안내', () => {
    act(() => root.render(<ApprovalQueue queue={Q} isAdmin={false} onChanged={() => {}} />))
    expect(host.querySelector('[data-queue-approve]')).toBeNull()
    expect(host.textContent).toContain('승인은 관리자가 합니다')
  })
})

describe('HubStatusBar', () => {
  const base = { projectId: 'p1', counters: { delegated: 3, ready: 1, working: 1, waiting: 1 }, watchers: [], onChanged: () => {} }
  it('카운터 4개와 켜짐 배지, 관리자에게 토글', () => {
    act(() => root.render(<HubStatusBar {...base} registered enabled isAdmin watchers={[{ agent: 'hong/mbp', host: 'mbp', slots: 2, busy: 1, untilLabel: '18:00', lastSeenAt: '2026-09-14T08:59:00Z', projectId: 'p1' }]} />))
    expect(host.querySelector('[data-hub-counter="delegated"]')?.textContent).toBe('3')
    expect(host.querySelector('[data-hub-counter="waiting"]')?.textContent).toBe('1')
    expect(host.textContent).toContain('hong/mbp 1/2 ~18:00')
    expect(host.querySelector('button')).not.toBeNull()
    expect((host.querySelector('a[href="/account"]') as HTMLAnchorElement).textContent).toContain('내 토큰')
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
