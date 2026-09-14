// tests/components/agent-hub-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentHub, HubRow } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateAgentPrompt = vi.fn(), applyHubDelegations = vi.fn()
vi.mock('@/app/actions/wbsSpec', () => ({ updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])) }))
vi.mock('@/app/actions/agentHub', () => ({ applyHubDelegations: (...a: unknown[]) => applyHubDelegations(...(a as [])) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { DelegationTable } from '@/components/agent-hub/DelegationTable'
import { HUB_SAVE_DEBOUNCE_MS } from '@/components/agent-hub/usePendingDelegations'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const row = (over: Partial<HubRow>): HubRow => ({
  itemId: 'x', code: 'X', name: 'x', depth: 0, parentId: null, isLeaf: true, milestone: false, assigneeName: null, assigneeMine: false,
  delegated: false, devWorkflow: false, order: null, prompt: null, canToggle: false, unmetDepends: null, ...over,
})
const ROWS: HubRow[] = [
  row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
  row({ itemId: 'a1', code: 'TSK-A-01', name: '리프1', depth: 1, parentId: 'root', assigneeName: '장종익1', assigneeMine: true, canToggle: true, delegated: true, devWorkflow: true, order: { id: 'o1', status: 'claimed', state: 'ACTIVE', agent: 'hong/mbp/w1', lastSignalAt: new Date(NOW - 42_000).toISOString() } }),
  row({ itemId: 'a2', code: 'TSK-A-02', name: '리프2', depth: 1, parentId: 'root', assigneeName: '남', canToggle: false, devWorkflow: true }),
  row({ itemId: 'ms', code: 'MS-1', name: '마일스톤', depth: 1, parentId: 'root', milestone: true }),
]
const HUB = { projectId: 'p1', rows: ROWS } as unknown as AgentHub
const OK = (over: Record<string, unknown> = {}) => ({ ok: true, hub: HUB, failed: [], warnings: [], ...over })

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.useFakeTimers()
  updateAgentPrompt.mockReset(); applyHubDelegations.mockReset()
  applyHubDelegations.mockResolvedValue(OK())
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const render = (over: Partial<Parameters<typeof DelegationTable>[0]> = {}) => {
  const onChanged = vi.fn(async () => {}), onHub = vi.fn()
  act(() => root.render(<DelegationTable rows={ROWS} projectId="p1" isAdmin={false} filter="all" onFilter={() => {}} nowMs={NOW} onHub={onHub} onChanged={onChanged} {...over} />))
  return { onChanged, onHub }
}
const toggle = (id: string) => host.querySelector(`[data-hub-row="${id}"] input[data-hub-toggle]`) as HTMLInputElement
const parent = (id: string) => host.querySelector(`[data-hub-row="${id}"] input[data-hub-parent-toggle]`) as HTMLInputElement
const click = (el: HTMLElement) => act(async () => { el.click() })
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(HUB_SAVE_DEBOUNCE_MS) })
const text = (sel: string) => (host.querySelector(sel) as HTMLElement | null)?.textContent ?? null

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
  it('필터 mine 은 내 담당 리프와 조상만', () => {
    render({ filter: 'mine' })
    expect(host.querySelector('[data-hub-row="a1"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="root"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="a2"]')).toBeNull()
    expect((host.querySelector('[data-hub-filter="mine"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
  })
  it('부모 접기 → 자식 숨김', async () => {
    render()
    await click(host.querySelector('[data-hub-row="root"] [data-hub-fold]') as HTMLButtonElement)
    expect(host.querySelector('[data-hub-row="a1"]')).toBeNull()
  })
  it('프롬프트 편집 — 자격 있는 행만 연필, 저장하면 updateAgentPrompt + onChanged(재조회)', async () => {
    updateAgentPrompt.mockResolvedValueOnce({ ok: true })
    const { onChanged } = render()
    expect(host.querySelector('[data-hub-row="a2"] [data-hub-prompt-edit]')).toBeNull()
    await click(host.querySelector('[data-hub-row="a1"] [data-hub-prompt-edit]') as HTMLButtonElement)
    const ta = host.querySelector('[data-hub-row-extra="a1"] textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '지시문'); ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(host.querySelector('[data-hub-row-extra="a1"] [data-hub-prompt-save]') as HTMLButtonElement)
    expect(updateAgentPrompt).toHaveBeenCalledWith('a1', '지시문')
    expect(onChanged).toHaveBeenCalled()
  })
})

describe('DelegationTable — 체크는 즉시 표시·잠기지 않음, 1.5초 모아 묶음 1건, 응답의 허브로 교체(2026-09-14 체크 지연 개선)', () => {
  it('체크 → 표시 즉시 반전, disabled 아님, 대기 칩 "1건", 액션은 아직 없음 → 지연 뒤 applyHubDelegations 1회 → onHub(hub), onChanged 없음', async () => {
    const { onHub, onChanged } = render()
    await click(toggle('a1'))
    expect(toggle('a1').checked).toBe(false); expect(toggle('a1').disabled).toBe(false)
    expect(text('[data-hub-pending-count]')).toBe('1건')
    expect(host.querySelector('[data-pending-save="pending"]')).not.toBeNull()
    expect(applyHubDelegations).not.toHaveBeenCalled()
    await settle()
    expect(applyHubDelegations).toHaveBeenCalledTimes(1)
    expect(applyHubDelegations).toHaveBeenCalledWith('p1', [{ itemId: 'a1', delegated: false }])
    expect(onHub).toHaveBeenCalledWith(HUB)
    expect(onChanged).not.toHaveBeenCalled()
    expect(host.querySelector('[data-hub-pending]')).toBeNull()
  })
  it('켰다 끄면 저장하지 않는다', async () => {
    render()
    await click(toggle('a1')); await click(toggle('a1'))
    expect(host.querySelector('[data-hub-pending]')).toBeNull()
    await settle()
    expect(applyHubDelegations).not.toHaveBeenCalled()
  })
  it('「지금 저장」은 기다리지 않는다', async () => {
    render()
    await click(toggle('a1'))
    await click(host.querySelector('[data-pending-save-now]') as HTMLButtonElement)
    expect(applyHubDelegations).toHaveBeenCalledTimes(1)
  })
  it('항목 실패 → 그 행만 서버값으로 되돌리고 행에 오류; warning 은 행 아래 문구', async () => {
    applyHubDelegations.mockResolvedValueOnce(OK({ failed: [{ itemId: 'a1', error: '거부' }] }))
    render()
    await click(toggle('a1'))
    await settle()
    expect(toggle('a1').checked).toBe(true)
    expect(text('[data-hub-row-extra="a1"] [data-hub-error]')).toContain('거부')
    expect(host.querySelector('[data-hub-notice]')).toBeNull()
    applyHubDelegations.mockResolvedValueOnce(OK({ warnings: [{ itemId: 'a1', warning: '중지 상태라 주문 안 나감' }] }))
    await click(toggle('a1'))
    await settle()
    expect(host.querySelector('[data-hub-row-extra="a1"] [data-hub-error]')).toBeNull()
    expect(text('[data-hub-row-extra="a1"] [data-hub-warning]')).toContain('중지 상태')
  })
  it('묶음 전체 거부(ok:false) → 보낸 행마다 그 문구, 되돌림', async () => {
    applyHubDelegations.mockResolvedValueOnce({ ok: false, error: '권한이 없습니다.' })
    const { onHub } = render()
    await click(toggle('a1'))
    await settle()
    expect(toggle('a1').checked).toBe(true)
    expect(text('[data-hub-row-extra="a1"] [data-hub-error]')).toBe('권한이 없습니다.')
    expect(onHub).not.toHaveBeenCalled()
  })
  it('액션이 throw 하면(네트워크) 보낸 행에 그 메시지, 되돌림', async () => {
    applyHubDelegations.mockRejectedValueOnce(new Error('fetch failed'))
    render()
    await click(toggle('a1'))
    await settle()
    expect(toggle('a1').checked).toBe(true)
    expect(text('[data-hub-row-extra="a1"] [data-hub-error]')).toBe('fetch failed')
  })
  it('저장은 됐고 재조회만 실패(hub:null) → 알림 줄 + onChanged 로 재조회 1회', async () => {
    applyHubDelegations.mockResolvedValueOnce(OK({ hub: null, hubError: '변경은 저장됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.' }))
    const { onHub, onChanged } = render()
    await click(toggle('a1'))
    await settle()
    expect(text('[data-hub-notice]')).toContain('재조회에 실패')
    expect(onHub).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
  it('멤버에게는 부모 체크가 없고, 관리자의 indeterminate 부모 체크는 하위 리프(마일스톤 제외)를 한 묶음에 — 이미 같은 값인 리프는 보내지 않는다', async () => {
    render()
    expect(parent('root')).toBeNull()
    const { onHub } = render({ isAdmin: true })
    expect(parent('root').indeterminate).toBe(true)
    await click(parent('root'))
    expect(toggle('a1').checked).toBe(true); expect(toggle('a2').checked).toBe(true)
    expect(parent('root').indeterminate).toBe(false); expect(parent('root').checked).toBe(true)
    expect(text('[data-hub-pending-count]')).toBe('1건') // a1 은 이미 위임 상태
    await settle()
    expect(applyHubDelegations).toHaveBeenCalledWith('p1', [{ itemId: 'a2', delegated: true }])
    expect(onHub).toHaveBeenCalled()
  })
  it('두 건 이상 실패는 표 위 알림 줄에 코드로', async () => {
    const rows = ROWS.map(r => (r.itemId === 'a1' ? { ...r, delegated: false } : r))
    applyHubDelegations.mockResolvedValueOnce(OK({ failed: [{ itemId: 'a1', error: '리프 아님' }, { itemId: 'a2', error: '리프 아님' }] }))
    render({ rows, isAdmin: true })
    await click(parent('root'))
    await settle()
    expect(applyHubDelegations).toHaveBeenCalledWith('p1', [{ itemId: 'a1', delegated: true }, { itemId: 'a2', delegated: true }])
    expect(text('[data-hub-notice]')).toBe('2건 실패: TSK-A-01, TSK-A-02')
    expect(text('[data-hub-row-extra="a1"] [data-hub-error]')).toBe('리프 아님')
  })
  it('연달아 체크한 두 행은 한 묶음에 실린다(체크 사이 1초, 마지막 뒤 1.5초)', async () => {
    const rows = ROWS.map(r => (r.itemId === 'a2' ? { ...r, canToggle: true } : r))
    render({ rows })
    await click(toggle('a1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await click(toggle('a2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(applyHubDelegations).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(applyHubDelegations).toHaveBeenCalledTimes(1)
    expect(applyHubDelegations).toHaveBeenCalledWith('p1', [{ itemId: 'a1', delegated: false }, { itemId: 'a2', delegated: true }])
  })
})

describe('DelegationTable — 선행 미완료', () => {
  it('unmetDepends 가 있으면 상태 칸에 "선행 미완료: 목록" 을 그리고 title 에 전문을 둔다', () => {
    const rows = [row({ itemId: 'd1', code: 'TSK-D-01', name: '후속', delegated: true, devWorkflow: true, canToggle: true, unmetDepends: 'TSK-D-00 선행(현재 fp(기능 계획))' })]
    render({ rows })
    const el = host.querySelector('[data-hub-row="d1"] [data-hub-depends]') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.textContent).toBe('선행 미완료: TSK-D-00 선행(현재 fp(기능 계획))')
    expect(el.title).toContain('선행이 im(구현) 단계 이상이 되거나 그 주문이 승인돼야')
  })
  it('unmetDepends 가 null 이면 그리지 않는다', () => {
    render()
    expect(host.querySelector('[data-hub-depends]')).toBeNull()
  })
})
