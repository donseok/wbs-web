// tests/components/agent-hub-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentHub, HubRow } from '@/lib/domain/agentHub'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateAgentPrompt = vi.fn(), applyHubDelegations = vi.fn(), runHubProcessOp = vi.fn()
vi.mock('@/app/actions/wbsSpec', () => ({ updateAgentPrompt: (...a: unknown[]) => updateAgentPrompt(...(a as [])) }))
vi.mock('@/app/actions/agentHub', () => ({
  applyHubDelegations: (...a: unknown[]) => applyHubDelegations(...(a as [])),
  runHubProcessOp: (...a: unknown[]) => runHubProcessOp(...(a as [])),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { DelegationTable } from '@/components/agent-hub/DelegationTable'
import { HUB_SAVE_DEBOUNCE_MS } from '@/components/agent-hub/usePendingDelegations'

const NOW = Date.parse('2026-09-14T09:00:00Z')
const row = (over: Partial<HubRow>): HubRow => ({
  itemId: 'x', code: 'X', name: 'x', depth: 0, parentId: null, isLeaf: true, milestone: false, assigneeName: null, assigneeMine: false,
  canManage: false,
  delegated: false, devWorkflow: false, stage: null, stageLocked: false, order: null, prompt: null, canToggle: false, waitReason: null, ...over,
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
  updateAgentPrompt.mockReset(); applyHubDelegations.mockReset(); runHubProcessOp.mockReset()
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
    expect(toggle('a1').title).toContain('취소') // 체크된 위임은 "끄면 대기 주문이 취소된다"고 툴팁으로 안내(취소 버튼 제거, §11-2 개정)
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

describe('DelegationTable — 착수 대기 사유', () => {
  it('waitReason 이 있으면 상태 칸에 라벨을 그리고 title 에 전문, data-wait-reason 에 종류를 둔다', () => {
    const rows = [row({ itemId: 'd1', code: 'TSK-D-01', name: '후속', delegated: true, devWorkflow: true, canToggle: true,
      waitReason: { kind: 'dependency', label: '선행 대기', text: '선행 작업이 아직 끝나지 않았습니다: TSK-D-00 선행(현재 fp(기능 계획)). 선행이 검수 대기(im) 이상이 되거나, 그 주문이 승인되거나, 실적이 100% 가 돼야 이 작업을 집어갈 수 있습니다.' } })]
    render({ rows })
    const el = host.querySelector('[data-hub-row="d1"] [data-hub-depends]') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.textContent).toBe('선행 대기')
    expect(el.getAttribute('data-wait-reason')).toBe('dependency')
    expect(el.title).toContain('선행이 검수 대기(im) 이상이 되거나, 그 주문이 승인되거나, 실적이 100% 가 돼야')
  })
  it('waitReason 이 null 이면 그리지 않는다', () => {
    render()
    expect(host.querySelector('[data-hub-depends]')).toBeNull()
  })
})

describe('DelegationTable — 개발 프로세스 조정·단계 직접 조정(§11): 관리자만, runHubProcessOp 1건, 응답의 허브로 교체', () => {
  const NOTE_ROWS: HubRow[] = [
    row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
    row({ itemId: 'w', code: 'TSK-W', name: '승인 대기', depth: 1, parentId: 'root', canToggle: true, delegated: true, devWorkflow: true, stage: 'im', order: { id: 'ow', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'd', code: 'TSK-D', name: '승인됨', depth: 1, parentId: 'root', canToggle: true, delegated: true, devWorkflow: true, stage: 'xx', order: { id: 'od', status: 'approved', state: 'DONE', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'c', code: 'TSK-C', name: '작업 중', depth: 1, parentId: 'root', canToggle: true, delegated: true, devWorkflow: true, stage: 'im', order: { id: 'oc', status: 'claimed', state: 'STALE', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'r', code: 'TSK-R', name: '대기', depth: 1, parentId: 'root', canToggle: true, delegated: true, devWorkflow: true, stage: 'as', order: { id: 'or', status: 'ready', state: 'READY', agent: null, lastSignalAt: null } }),
    row({ itemId: 'n', code: 'TSK-N', name: '주문 없음', depth: 1, parentId: 'root', canToggle: true, devWorkflow: true }),
    row({ itemId: 'ms', code: 'MS-1', name: '마일스톤', depth: 1, parentId: 'root', milestone: true, stage: 'xx' }),
  ]
  const ops = (id: string) => [...host.querySelectorAll(`[data-hub-row="${id}"] [data-hub-op]`)].map(b => b.getAttribute('data-hub-op'))
  const op = (id: string, kind: string) => host.querySelector(`[data-hub-row="${id}"] [data-hub-op="${kind}"]`) as HTMLButtonElement
  const stageSel = (id: string) => host.querySelector(`[data-hub-row="${id}"] select[data-hub-stage]`) as HTMLSelectElement | null
  const pick = (sel: HTMLSelectElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, v); sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const typeNote = (v: string) => act(async () => {
    const ta = host.querySelector('[data-hub-note] textarea') as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('멤버: 단계는 글자로, 조정 버튼 없음', () => {
    render({ rows: NOTE_ROWS, isAdmin: false })
    expect(stageSel('w')).toBeNull()
    expect(text('[data-hub-row="w"] [data-hub-stage-text]')).toBe('검수 대기')
    expect(text('[data-hub-row="n"] [data-hub-stage-text]')).toBe('미착수')
    expect(host.querySelector('[data-hub-op]')).toBeNull()
  })
  it('관리자: 주문 상태별 버튼 — 승인 대기(승인·반려), 승인됨(승인 취소·재작업 요청), 작업 중(회수), 대기·없음·마일스톤(없음)', () => {
    render({ rows: NOTE_ROWS, isAdmin: true })
    expect(ops('w')).toEqual(['approve', 'reject'])
    expect(ops('d')).toEqual(['unapprove', 'rework'])
    expect(ops('c')).toEqual(['release'])
    expect(ops('r')).toEqual([]); expect(ops('n')).toEqual([]); expect(ops('ms')).toEqual([])
    expect(op('w', 'approve').textContent).toBe('승인'); expect(op('d', 'rework').textContent).toBe('재작업 요청'); expect(op('c', 'release').textContent).toBe('회수')
    expect(op('d', 'rework').title).toContain('완료(xx)를 취소')
    expect(stageSel('ms')).toBeNull() // 마일스톤은 단계 없음
  })
  it('승인 → runHubProcessOp(p1, {approve, orderId}) → onHub(hub); 회수·승인 취소도 같은 길', async () => {
    runHubProcessOp.mockResolvedValue({ ok: true, hub: HUB })
    const { onHub, onChanged } = render({ rows: NOTE_ROWS, isAdmin: true })
    await click(op('w', 'approve'))
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'approve', orderId: 'ow' })
    expect(onHub).toHaveBeenCalledWith(HUB); expect(onChanged).not.toHaveBeenCalled()
    await click(op('c', 'release'))
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'release', orderId: 'oc' })
    await click(op('d', 'unapprove'))
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'unapprove', orderId: 'od' })
  })
  it('반려·재작업 요청은 사유 줄을 열고, 비면 확정 비활성, 채우면 note 와 함께 보낸다', async () => {
    runHubProcessOp.mockResolvedValue({ ok: true, hub: HUB })
    render({ rows: NOTE_ROWS, isAdmin: true })
    await click(op('d', 'rework'))
    expect(host.querySelector('[data-hub-row-extra="d"] [data-hub-note="rework"]')).not.toBeNull()
    const confirm = host.querySelector('[data-hub-note-confirm]') as HTMLButtonElement
    expect(confirm.disabled).toBe(true); expect(confirm.textContent).toBe('재작업 요청 확정')
    await typeNote('테스트가 빠졌음')
    expect(confirm.disabled).toBe(false)
    await click(confirm)
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'rework', orderId: 'od', note: '테스트가 빠졌음' })
    expect(host.querySelector('[data-hub-note]')).toBeNull() // 성공하면 닫힌다
    await click(op('w', 'reject'))
    expect(host.querySelector('[data-hub-row-extra="w"] [data-hub-note="reject"]')).not.toBeNull()
  })
  it('실패는 그 행 아래 오류, warning 은 경고 문구, hub:null 은 알림 줄 + onChanged', async () => {
    runHubProcessOp.mockResolvedValueOnce({ ok: false, error: '승인 가능한 상태가 아닙니다(claimed).' })
    const { onHub, onChanged } = render({ rows: NOTE_ROWS, isAdmin: true })
    await click(op('w', 'approve'))
    expect(text('[data-hub-row-extra="w"] [data-hub-error]')).toContain('승인 가능한 상태가 아닙니다')
    expect(onHub).not.toHaveBeenCalled()
    runHubProcessOp.mockResolvedValueOnce({ ok: true, hub: HUB, warning: '실적을 되돌리지 않았습니다' })
    await click(op('d', 'unapprove'))
    expect(text('[data-hub-row-extra="d"] [data-hub-warning]')).toContain('실적을 되돌리지')
    runHubProcessOp.mockResolvedValueOnce({ ok: true, hub: null, hubError: '처리는 됐지만 현황 재조회에 실패했습니다. 새로고침을 누르세요.' })
    await click(op('c', 'release'))
    expect(text('[data-hub-notice]')).toContain('재조회에 실패')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
  it('단계 select: 서버가 계산한 stageLocked 면 잠그고 이유를 title 로 — 8상태에서 다시 추론하지 않는다', () => {
    render({ rows: [row({ itemId: 'lk', code: 'TSK-LK', name: '위임 작업', isLeaf: true, devWorkflow: true, delegated: true, stageLocked: true, stage: 'ip', order: { id: 'olk', status: 'ready', state: 'READY', agent: null, lastSignalAt: null } }), row({ itemId: 'hm', code: 'TSK-HM', name: '사람 작업', isLeaf: true, devWorkflow: true, stageLocked: false, stage: 'as' })], isAdmin: true })
    expect(stageSel('lk')!.disabled).toBe(true)
    expect(stageSel('lk')!.title).toContain('위임을 끄세요')
    expect(stageSel('hm')!.disabled).toBe(false)
  })
  it('단계 select: dev_workflow 가 꺼진 리프에는 select 를 두지 않는다', () => {
    render({ rows: [row({ itemId: 'nw', code: 'TSK-NW', name: '레거시', isLeaf: true, devWorkflow: false })], isAdmin: true })
    expect(stageSel('nw')).toBeNull()
  })
  it('단계 select: 현재값 표시, 고르면 {stage, itemId, stage} 즉시 전송, 성공 → onHub; 실패 → 오류 + 서버값으로 복귀', async () => {
    runHubProcessOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    const { onHub } = render({ rows: NOTE_ROWS, isAdmin: true })
    expect(stageSel('w')!.value).toBe('im'); expect(stageSel('n')!.value).toBe('')
    expect([...stageSel('n')!.options].map(o => o.textContent)).toEqual(['미착수', '할당됨', '작업 중', '검수 대기', '완료'])
    await pick(stageSel('n')!, 'ip')
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'stage', itemId: 'n', stage: 'ip' })
    expect(onHub).toHaveBeenCalledWith(HUB)
    runHubProcessOp.mockResolvedValueOnce({ ok: false, error: '이 항목에 진행 중인 에이전트 주문이 있습니다 — 단계 변경은 "진행 상황"의 승인 버튼으로 하세요.' })
    await pick(stageSel('c')!, 'xx')
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'stage', itemId: 'c', stage: 'xx' })
    expect(text('[data-hub-row-extra="c"] [data-hub-error]')).toContain('진행 중인 에이전트 주문')
    expect(stageSel('c')!.value).toBe('im')
    runHubProcessOp.mockResolvedValueOnce({ ok: true, hub: HUB })
    await pick(stageSel('w')!, '')
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'stage', itemId: 'w', stage: null })
  })
})

describe('DelegationTable — 담당자 본인도 반려·승인 취소·재작업(승인·회수·단계는 관리자만, 2026-09-14 §11)', () => {
  const MINE: HubRow[] = [
    row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
    row({ itemId: 'w', code: 'TSK-W', name: '승인 대기', depth: 1, parentId: 'root', assigneeMine: true, canToggle: true, delegated: true, devWorkflow: true, stage: 'im', order: { id: 'ow', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'd', code: 'TSK-D', name: '승인됨', depth: 1, parentId: 'root', assigneeMine: true, canToggle: true, delegated: true, stage: 'xx', order: { id: 'od', status: 'approved', state: 'DONE', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'c', code: 'TSK-C', name: '작업 중', depth: 1, parentId: 'root', assigneeMine: true, canToggle: true, delegated: true, stage: 'im', order: { id: 'oc', status: 'claimed', state: 'STALE', agent: 'a', lastSignalAt: null } }),
    row({ itemId: 'o', code: 'TSK-O', name: '남의 승인 대기', depth: 1, parentId: 'root', assigneeMine: false, delegated: true, stage: 'im', order: { id: 'oo', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
  ]
  const ops = (id: string) => [...host.querySelectorAll(`[data-hub-row="${id}"] [data-hub-op]`)].map(b => b.getAttribute('data-hub-op'))
  const op = (id: string, kind: string) => host.querySelector(`[data-hub-row="${id}"] [data-hub-op="${kind}"]`) as HTMLButtonElement

  it('멤버(isAdmin=false): 내 담당 승인 대기 → 반려만(승인 없음), 승인됨 → 승인 취소·재작업, 작업 중 → 없음(회수는 관리자만)', () => {
    render({ rows: MINE, isAdmin: false })
    expect(ops('w')).toEqual(['reject'])
    expect(ops('d')).toEqual(['unapprove', 'rework'])
    expect(ops('c')).toEqual([]) // 회수(release)는 관리자만
    expect(host.querySelector('[data-hub-row="w"] select[data-hub-stage]')).toBeNull() // 단계 조정은 관리자만
    expect(host.querySelector('[data-hub-row="w"] [data-hub-stage-text]')?.textContent).toBe('검수 대기')
  })
  it('멤버는 남의 담당 항목에는 조정 버튼이 없다', () => {
    render({ rows: MINE, isAdmin: false })
    expect(ops('o')).toEqual([])
  })
  it('멤버의 반려·재작업도 runHubProcessOp 로 나간다', async () => {
    runHubProcessOp.mockResolvedValue({ ok: true, hub: HUB })
    render({ rows: MINE, isAdmin: false })
    await click(op('w', 'reject'))
    // 사유 줄이 열리고 확정 시 note 와 함께
    const ta = host.querySelector('[data-hub-row-extra="w"] [data-hub-note="reject"] textarea') as HTMLTextAreaElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, '내가 다시'); ta.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(host.querySelector('[data-hub-row-extra="w"] [data-hub-note-confirm]') as HTMLButtonElement)
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'reject', orderId: 'ow', note: '내가 다시' })
    await click(op('d', 'unapprove'))
    expect(runHubProcessOp).toHaveBeenCalledWith('p1', { kind: 'unapprove', orderId: 'od' })
  })
  it('관리자는 회수·단계까지 모두 보인다(대조군)', () => {
    render({ rows: MINE, isAdmin: true })
    expect(ops('w')).toEqual(['approve', 'reject'])
    expect(ops('c')).toEqual(['release'])
    expect(host.querySelector('[data-hub-row="w"] select[data-hub-stage]')).not.toBeNull()
    expect(ops('o')).toEqual(['approve', 'reject']) // 관리자는 남의 담당도
  })
})

describe('DelegationTable — 서브트리 관리자(canManage, 트랙 B 2026-09-15): approve·release·stage 는 canManage 도, 리프 본인은 review 만', () => {
  const MANAGE: HubRow[] = [
    row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
    // 서브트리 관리자가 관리하는 리프(조상 담당) — 승인 대기: approve·reject 둘 다 보여야 한다.
    row({ itemId: 'w', code: 'TSK-W', name: '승인 대기(관리 대상)', depth: 1, parentId: 'root', canManage: true, delegated: true, stage: 'im', order: { id: 'ow', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
    // 작업 중 → release 버튼 대상(관리자 전용 who='admin' 이 canManage 로도 열려야 한다).
    row({ itemId: 'c', code: 'TSK-C', name: '작업 중(관리 대상)', depth: 1, parentId: 'root', canManage: true, delegated: true, stage: 'im', order: { id: 'oc', status: 'claimed', state: 'STALE', agent: 'a', lastSignalAt: null } }),
    // 주문 없음 → 단계 select 대상.
    row({ itemId: 'n', code: 'TSK-N', name: '단계 조정 대상', depth: 1, parentId: 'root', canManage: true, devWorkflow: true }),
    // 리프 본인 담당자(조상 아님, canManage:false) — 분리 원칙: approve 는 못 보고 reject 만.
    row({ itemId: 'lw', code: 'TSK-LW', name: '내 승인 대기', depth: 1, parentId: 'root', assigneeMine: true, canManage: false, canToggle: true, delegated: true, stage: 'im', order: { id: 'olw', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
    // 무관 멤버 — 아무 자격 없음.
    row({ itemId: 'x', code: 'TSK-X', name: '남의 승인 대기', depth: 1, parentId: 'root', assigneeMine: false, canManage: false, delegated: true, stage: 'im', order: { id: 'ox', status: 'reported', state: 'WAIT', agent: 'a', lastSignalAt: null } }),
  ]
  const ops = (id: string) => [...host.querySelectorAll(`[data-hub-row="${id}"] [data-hub-op]`)].map(b => b.getAttribute('data-hub-op'))

  it("필터 mine: 서브트리 관리 리프(canManage)도 내 담당(assigneeMine)처럼 보인다, 조상 포함 — 무관 멤버 리프는 안 보인다", () => {
    render({ rows: MANAGE, isAdmin: false, filter: 'mine' })
    for (const id of ['root', 'w', 'c', 'n', 'lw']) expect(host.querySelector(`[data-hub-row="${id}"]`)).not.toBeNull()
    expect(host.querySelector('[data-hub-row="x"]')).toBeNull()
  })
  it('서브트리 관리자(멤버, isAdmin=false): 관리 대상 리프에 approve·reject·release·stage 가 뜬다', () => {
    render({ rows: MANAGE, isAdmin: false })
    expect(ops('w')).toEqual(['approve', 'reject'])
    expect(ops('c')).toEqual(['release'])
    expect(host.querySelector('[data-hub-row="n"] select[data-hub-stage]')).not.toBeNull()
  })
  it('리프 본인 담당자(canManage 아님): review 만 — approve 는 안 뜨고 단계 select 도 없다(분리 원칙)', () => {
    render({ rows: MANAGE, isAdmin: false })
    expect(ops('lw')).toEqual(['reject'])
    expect(host.querySelector('[data-hub-row="lw"] select[data-hub-stage]')).toBeNull()
  })
  it('무관 멤버: 조정 버튼이 없다', () => {
    render({ rows: MANAGE, isAdmin: false })
    expect(ops('x')).toEqual([])
    expect(host.querySelector('[data-hub-row="x"] select[data-hub-stage]')).toBeNull()
  })
})

describe('DelegationTable — 이름 클릭 → onSelect(상세 패널 열기, 2026-09-15)', () => {
  it('onSelect 를 주면 이름이 버튼이 되고 클릭 시 itemId 로 부른다', async () => {
    const onSelect = vi.fn()
    render({ onSelect })
    const btn = host.querySelector('[data-hub-row="a1"] [data-hub-open="a1"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    await click(btn)
    expect(onSelect).toHaveBeenCalledWith('a1')
  })
  it('onSelect 가 없으면 이름은 클릭 불가 텍스트(버튼 아님)', () => {
    render()
    expect(host.querySelector('[data-hub-open]')).toBeNull()
    expect((host.querySelector('[data-hub-row="a1"]') as HTMLElement).textContent).toContain('리프1')
  })
})

describe('DelegationTable — 열 너비·고정·밀도(2026-09-17 개편)', () => {
  const colEl = (key: string) => host.querySelector(`col[data-col="${key}"]`) as HTMLElement
  const handle = (key: string) => host.querySelector(`[data-rsz="${key}"]`) as HTMLButtonElement
  const key = (el: HTMLElement, k: string, shift = false) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true })) })
  const saved = () => { try { return JSON.parse(localStorage.getItem('dflow-hub-colw') ?? 'null') } catch { return null } }
  beforeEach(() => { try { localStorage.clear() } catch {} })

  it('여유 열을 뺀 일곱 열 모두에 손잡이가 있고, 여유 열에는 없다', () => {
    render()
    for (const k of ['check', 'code', 'name', 'owner', 'state', 'agent', 'ops']) expect(handle(k), k).not.toBeNull()
    expect(handle('slack')).toBeNull()
    expect(colEl('slack')).not.toBeNull()
    expect(colEl('slack').style.width).toBe('') // 남는 폭을 먹는다 — px 를 주지 않는다
  })
  it('마우스 없이도 조절된다 — ←/→ 8px, Shift 32px, Home 기본값. 결과는 이 브라우저에 남는다', () => {
    render()
    expect(colEl('name').style.width).toBe('296px')
    key(handle('name'), 'ArrowRight')
    expect(colEl('name').style.width).toBe('304px')
    expect(saved().name).toBe(304)
    key(handle('name'), 'ArrowLeft', true)
    expect(colEl('name').style.width).toBe('272px')
    key(handle('name'), 'Home')
    expect(colEl('name').style.width).toBe('296px')
  })
  it('최소 폭 아래로는 줄지 않는다 — table-layout: fixed 라 더 줄이면 내용이 잘린다', () => {
    render()
    for (let i = 0; i < 20; i++) key(handle('ops'), 'ArrowLeft', true)
    expect(colEl('ops').style.width).toBe('96px')
  })
  it('저장된 폭이 있으면 그 폭으로 그린다', () => {
    try { localStorage.setItem('dflow-hub-colw', JSON.stringify({ name: 400, bogus: 1 })) } catch {}
    render()
    expect(colEl('name').style.width).toBe('400px')
    expect(colEl('code').style.width).toBe('126px')
  })
  it('망가진 저장값이어도 기본 폭으로 그린다', () => {
    try { localStorage.setItem('dflow-hub-colw', '{ 깨짐') } catch {}
    render()
    expect(colEl('name').style.width).toBe('296px')
  })
})

describe('DelegationTable — 승인 대기만·착수 대기 사유 펼침(2026-09-17 개편)', () => {
  const WAIT_ROWS: HubRow[] = [
    row({ itemId: 'root', code: 'SYS-OP', name: '조업', isLeaf: false }),
    row({ itemId: 'w1', code: 'TSK-W-01', name: '보고됨', depth: 1, parentId: 'root', delegated: true, devWorkflow: true, canToggle: true,
      order: { id: 'o9', status: 'reported', state: 'WAIT', agent: 'hong/mbp', lastSignalAt: null } }),
    row({ itemId: 'w2', code: 'TSK-W-02', name: '그냥', depth: 1, parentId: 'root', delegated: true, devWorkflow: true }),
  ]
  it('「승인 대기만」을 켜면 WAIT 리프와 그 조상만 남는다', async () => {
    render({ rows: WAIT_ROWS })
    expect(host.querySelector('[data-hub-row="w2"]')).not.toBeNull()
    await click(host.querySelector('[data-hub-only-wait]') as HTMLButtonElement)
    expect(host.querySelector('[data-hub-row="w1"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="root"]')).not.toBeNull()
    expect(host.querySelector('[data-hub-row="w2"]')).toBeNull()
  })
  it('사유 칩을 누르면 펼침 행에 전문이 열리고, 다시 누르면 닫힌다', async () => {
    const rows = [row({ itemId: 'd1', code: 'TSK-D-01', name: '후속', delegated: true, devWorkflow: true, canToggle: true,
      waitReason: { kind: 'agent_off', label: '에이전트 꺼짐', text: '담당자 장종익1 의 에이전트가 켜져 있지 않습니다.' } })]
    render({ rows })
    const chip = host.querySelector('[data-hub-row="d1"] [data-hub-depends]') as HTMLButtonElement
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    await click(chip)
    expect(text('[data-hub-row-extra="d1"] [data-hub-reason-text]')).toContain('에이전트가 켜져 있지 않습니다')
    await click(host.querySelector('[data-hub-row="d1"] [data-hub-depends]') as HTMLButtonElement)
    expect(host.querySelector('[data-hub-row-extra="d1"]')).toBeNull()
  })
})
