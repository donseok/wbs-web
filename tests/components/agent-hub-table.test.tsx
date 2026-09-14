// tests/components/agent-hub-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { HubRow } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const setAgentDelegation = vi.fn(), updateAgentPrompt = vi.fn(), setAgentDelegationBulk = vi.fn()
vi.mock('@/app/actions/wbsSpec', () => ({ setAgentDelegation: (...a: unknown[]) => setAgentDelegation(...(a as [])), updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])) }))
vi.mock('@/app/actions/agentHub', () => ({ setAgentDelegationBulk: (...a: unknown[]) => setAgentDelegationBulk(...(a as [])) }))
import { DelegationTable } from '@/components/agent-hub/DelegationTable'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const row = (over: Partial<HubRow>): HubRow => ({
  itemId: 'x', code: 'X', name: 'x', depth: 0, parentId: null, isLeaf: true, milestone: false, assigneeName: null, assigneeMine: false,
  delegated: false, devWorkflow: false, order: null, prompt: null, canToggle: false, ...over,
})
const ROWS: HubRow[] = [
  row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
  row({ itemId: 'a1', code: 'TSK-A-01', name: '리프1', depth: 1, parentId: 'root', assigneeName: '장종익1', assigneeMine: true, canToggle: true, delegated: true, devWorkflow: true, order: { id: 'o1', status: 'claimed', state: 'ACTIVE', agent: 'hong/mbp/w1', lastSignalAt: new Date(NOW - 42_000).toISOString() } }),
  row({ itemId: 'a2', code: 'TSK-A-02', name: '리프2', depth: 1, parentId: 'root', assigneeName: '남', canToggle: false, devWorkflow: true }),
  row({ itemId: 'ms', code: 'MS-1', name: '마일스톤', depth: 1, parentId: 'root', milestone: true }),
]

let host: HTMLDivElement, root: Root
beforeEach(() => { setAgentDelegation.mockReset(); updateAgentPrompt.mockReset(); setAgentDelegationBulk.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = (over: Partial<Parameters<typeof DelegationTable>[0]> = {}) => {
  const onChanged = vi.fn(async () => {})
  act(() => root.render(<DelegationTable rows={ROWS} projectId="p1" isAdmin={false} filter="all" onFilter={() => {}} nowMs={NOW} onChanged={onChanged} {...over} />))
  return { onChanged }
}
const toggle = (id: string) => host.querySelector(`[data-hub-row="${id}"] input[data-hub-toggle]`) as HTMLInputElement

describe('DelegationTable', () => {
  it('행마다 코드·이름·담당자·상태·에이전트·신호가 보이고 들여쓰기는 depth 를 따른다', () => {
    render()
    const r = host.querySelector('[data-hub-row="a1"]') as HTMLElement
    expect(r.textContent).toContain('TSK-A-01'); expect(r.textContent).toContain('장종익1')
    expect(r.textContent).toContain('작업 중'); expect(r.textContent).toContain('hong/mbp/w1'); expect(r.textContent).toContain('42초 전')
    expect((r.querySelector('[data-hub-name]') as HTMLElement).style.paddingLeft).toBe('16px')
    expect((host.querySelector('[data-hub-row="a2"]') as HTMLElement).textContent).toContain('위임 필요')
    expect((host.querySelector('[data-hub-row="root"]') as HTMLElement).textContent).toContain('—')
  })
  it('canToggle 인 리프만 체크 가능, 아니면 disabled + title', () => {
    render()
    expect(toggle('a1').disabled).toBe(false); expect(toggle('a1').checked).toBe(true)
    expect(toggle('a2').disabled).toBe(true); expect(toggle('a2').title).toBe('담당자 본인 또는 관리자만')
    expect(toggle('ms').disabled).toBe(true)
  })
  it('체크 → 낙관적 갱신 + setAgentDelegation 호출 + onChanged; 실패면 되돌리고 행에 오류', async () => {
    setAgentDelegation.mockResolvedValueOnce({ ok: true })
    const { onChanged } = render()
    await act(async () => { toggle('a1').click() })
    expect(setAgentDelegation).toHaveBeenCalledWith('a1', false)
    expect(onChanged).toHaveBeenCalledTimes(1)
    setAgentDelegation.mockResolvedValueOnce({ ok: false, error: '거부' })
    await act(async () => { toggle('a1').click() })
    expect(toggle('a1').checked).toBe(true)
    expect((host.querySelector('[data-hub-row-extra="a1"] [data-hub-error]') as HTMLElement).textContent).toContain('거부')
  })
  it('warning 은 행 아래 문구로', async () => {
    setAgentDelegation.mockResolvedValueOnce({ ok: true, warning: '중지 상태라 주문 안 나감' })
    render()
    await act(async () => { toggle('a1').click() })
    expect((host.querySelector('[data-hub-row-extra="a1"] [data-hub-warning]') as HTMLElement).textContent).toContain('중지 상태')
  })
  it('멤버에게는 부모 체크가 없고, 관리자에게는 indeterminate 부모 체크 → 하위 리프(마일스톤 제외) 일괄', async () => {
    render()
    expect(host.querySelector('[data-hub-row="root"] input[data-hub-parent-toggle]')).toBeNull()
    setAgentDelegationBulk.mockResolvedValueOnce({ ok: true, applied: 2, failed: [] })
    const { onChanged } = render({ isAdmin: true })
    const p = host.querySelector('[data-hub-row="root"] input[data-hub-parent-toggle]') as HTMLInputElement
    expect(p.indeterminate).toBe(true)
    await act(async () => { p.click() })
    expect(setAgentDelegationBulk).toHaveBeenCalledWith('p1', ['a1', 'a2'], true)
    expect(onChanged).toHaveBeenCalled()
  })
  it('일괄 부분 실패는 표 위 알림 줄에 코드로', async () => {
    setAgentDelegationBulk.mockResolvedValueOnce({ ok: true, applied: 1, failed: [{ itemId: 'a2', error: '리프 아님' }] })
    render({ isAdmin: true })
    await act(async () => { (host.querySelector('[data-hub-row="root"] input[data-hub-parent-toggle]') as HTMLInputElement).click() })
    expect((host.querySelector('[data-hub-notice]') as HTMLElement).textContent).toContain('TSK-A-02')
  })
  it('필터 mine 은 내 담당 리프와 조상만', () => {
    render({ filter: 'mine' })
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="root"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="a2"]')).toBeNull()
    expect((host.querySelector('[data-hub-filter="mine"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  })
  it('부모 접기 → 자식 숨김', async () => {
    render()
    await act(async () => { (host.querySelector('[data-hub-row="root"] [data-hub-fold]') as HTMLButtonElement).click() })
    expect(host.querySelector('[data-hub-row="a1"]')).toBeNull()
  })
  it('프롬프트 편집 — 자격 있는 행만 연필, 저장하면 updateAgentPrompt', async () => {
    updateAgentPrompt.mockResolvedValueOnce({ ok: true })
    const { onChanged } = render()
    expect(host.querySelector('[data-hub-row="a2"] [data-hub-prompt-edit]')).toBeNull()
    await act(async () => { (host.querySelector('[data-hub-row="a1"] [data-hub-prompt-edit]') as HTMLButtonElement).click() })
    const ta = host.querySelector('[data-hub-row-extra="a1"] textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '지시문'); ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { (host.querySelector('[data-hub-row-extra="a1"] [data-hub-prompt-save]') as HTMLButtonElement).click() })
    expect(updateAgentPrompt).toHaveBeenCalledWith('a1', '지시문')
    expect(onChanged).toHaveBeenCalled()
  })
})
