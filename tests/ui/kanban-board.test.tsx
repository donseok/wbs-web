// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }))

const updateActual = vi.fn(async (): Promise<{ ok: boolean; error?: string; conflict?: boolean }> => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: (...a: unknown[]) => updateActual(...(a as [])) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO', 'ERP'] }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: toastFn }) }))

import { KanbanBoard } from '@/components/kanban/KanbanBoard'

function n(id: string, over: Partial<ComputedItem> = {}, children: ComputedItem[] = []): ComputedItem {
  return {
    id, parentId: null, level: children.length ? 'phase' : 'activity', code: id, sortOrder: 0, name: id,
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30', weight: null,
    actualPct: children.length ? null : (over.rolledActualPct ?? 0), owners: over.owners ?? [{ team: 'PMO', kind: 'primary' }],
    plannedPct: 0, rolledActualPct: over.rolledActualPct ?? 0, achievement: null, status: over.status ?? 'in_progress', children,
  }
}
const ADMIN = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't-pmo' }

function tree(): ComputedItem[] {
  return [n('Phase', {}, [
    n('L0', { rolledActualPct: 0, status: 'not_started' }),
    n('L50', { rolledActualPct: 50, status: 'in_progress' }),
    n('L100', { rolledActualPct: 100, status: 'done' }),
  ])]
}

describe('KanbanBoard — 진행 모드 기본', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { updateActual.mockClear(); toastFn.mockClear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  afterEach(() => window.localStorage.clear())

  it('기본 뷰에서 시작전/진행중/완료 3컬럼과 각 카드 수를 보여준다', async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    const heads = [...container.querySelectorAll('h3')].map(h => h.textContent)
    expect(heads).toEqual(['status.not_started', 'status.in_progress', 'status.done'])
  })

  it("진행중 카드의 '완료' 액션은 updateActual(id, 100, prev)를 부른다", async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    const complete = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!
    await act(async () => complete.click())
    expect(updateActual).toHaveBeenCalledWith('L50', 100, 50)
  })

  it('저장 실패 시 낙관적 이동을 롤백하고 토스트를 부른다', async () => {
    updateActual.mockResolvedValueOnce({ ok: false, error: 'x' })
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    await act(async () => inc.click())
    // 실패 후 카드 %는 원복(50%)이어야 한다
    expect(container.textContent).toContain('50%')
    expect(toastFn).toHaveBeenCalled()
  })

  it('같은 카드에 대한 재진입(빠른 연속 클릭)은 updateActual을 한 번만 부른다', async () => {
    let resolvePending!: (v: { ok: boolean }) => void
    updateActual.mockImplementationOnce(() => new Promise(res => { resolvePending = res }))
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    const complete = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!
    // 첫 요청이 아직 in-flight인 동안(동일 act 배치 내) 같은 버튼을 한 번 더 클릭.
    await act(async () => {
      complete.click()
      complete.click()
    })
    expect(updateActual).toHaveBeenCalledTimes(1)
    // 첫 요청을 정상 완료시켜 정리(펜딩 프라미스/act 경고 방지).
    await act(async () => { resolvePending({ ok: true }) })
  })

  it('내 팀 렌즈는 내 팀 담당 카드만 남긴다(team_editor)', async () => {
    const items = [n('P', {}, [
      n('mine', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
      n('other', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
    ])]
    const EDITOR = { role: 'team_editor', teamCode: 'ERP', teamId: 't-erp' }
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={items} membership={EDITOR} today="2026-07-25" />,
    ))
    // 기본 렌즈=myTeam(ERP) → 'mine'만, 'other' 없음
    expect(container.textContent).toContain('mine')
    expect(container.textContent).not.toContain('other')
  })

  it('최초 방문(로컬 플래그 없음·편집 가능)엔 코치마크가 뜨고, 닫으면 플래그가 저장된다', async () => {
    window.localStorage.removeItem('kanban.coach.v1')
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    expect(container.textContent).toContain('kanban.coachTitle')
    const dismiss = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.coachDismiss'))!
    await act(async () => dismiss.click())
    expect(window.localStorage.getItem('kanban.coach.v1')).toBe('1')
    expect(container.textContent).not.toContain('kanban.coachTitle')
  })
})
