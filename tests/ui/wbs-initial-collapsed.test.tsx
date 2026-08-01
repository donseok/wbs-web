// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
const queueWbsCollapse = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: (...a: unknown[]) => queueWbsCollapse(...(a as [])) }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, level: 'activity', code: '1', sortOrder: 0, name: '항목', biz: null,
    deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0,
    owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}
function fixture(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', name: 'CBO (가공 주관)', owners: [{ team: '가공', kind: 'primary' }], isOwnerSplit: true }),
    item({ id: 's2', parentId: 'a1', name: 'CBO (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }], isOwnerSplit: true }),
  ]
  const multi = item({ id: 'a1', name: 'CBO', owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }], children: subs })
  const task = item({ id: 't1', level: 'task', name: '1-1. 작업', children: [multi] })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })]
}
function rowCount(c: HTMLElement) { return c.querySelectorAll('.group.relative.z-10').length }
// 3단 가정(‘항상 phase→task→activity 세 겹만 접힌 채 보인다’)이 되살아나면 이 중간 계층이 기본
// 접힘 판정을 흔들 수 있다 — multi(복수담당 activity) 는 그대로 두고 위에 실 계층만 하나 더 얹는다.
// splitParentIds 는 재귀 walk 라 깊이를 세지 않으므로, 얼마나 깊이 파묻혀 있어도 multi 를 찾아야 한다.
function fixtureDeep(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', name: 'CBO (가공 주관)', owners: [{ team: '가공', kind: 'primary' }], isOwnerSplit: true }),
    item({ id: 's2', parentId: 'a1', name: 'CBO (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }], isOwnerSplit: true }),
  ]
  const multi = item({ id: 'a1', name: 'CBO', owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }], children: subs })
  const subtask = item({ id: 'st1', level: 'task', name: '1-1-1. 세부 작업', children: [multi] })
  const task = item({ id: 't1', level: 'task', name: '1-1. 작업', children: [subtask] })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })]
}
// level 문자열이 'activity'/'phase'/'task' 관례를 전혀 따르지 않는 N단 트리 — 접기 대상 판정이
// n.level 문자열이 아니라 isOwnerSplit 플래그만 보는지 증명하는 회귀선(§4.4). 이 fixture는 구현이
// level 참조로 남아 있으면 RED, depth/isOwnerSplit 로 전환되면 GREEN이어야 한다.
function fixtureLevelAgnostic(): ComputedItem[] {
  const subs = [
    item({ id: 's1', parentId: 'a1', level: 'x', name: 'CBO (가공 주관)', owners: [{ team: '가공', kind: 'primary' }], isOwnerSplit: true }),
    item({ id: 's2', parentId: 'a1', level: 'x', name: 'CBO (ERP 주관)', owners: [{ team: 'ERP', kind: 'primary' }], isOwnerSplit: true }),
  ]
  const multi = item({ id: 'a1', level: 'custom-stage', name: 'CBO', owners: [{ team: '가공', kind: 'primary' }, { team: 'ERP', kind: 'primary' }], children: subs })
  const mid = item({ id: 'm1', level: 'custom-mid', name: '중간 계층', children: [multi] })
  const task = item({ id: 't1', level: 'custom-task', name: '1-1. 작업', children: [mid] })
  return [item({ id: 'p1', level: 'custom-root', name: '1. 준비', children: [task] })]
}
// Bar()는 depthMap을 재계산하는 flatRows 스코프 밖의 별도 함수라 n.depth 필드를 직접 읽는다(WbsGanttSheet.tsx).
// 위의 다른 fixture들은 item() 기본값 depth:0을 아무도 덮어쓰지 않아 모든 노드가 "depth 0"으로 보이므로
// Bar의 depth===0 분기를 실제로 가르지 못한다 — 이 fixture만 실제 중첩과 일치하는 depth를 명시로 부여한다.
// level 문자열은 일부러 'phase'/'task' 관례를 안 따르게(custom-*) 지어 Bar가 n.level 이 아니라 n.depth 를
// 읽는다는 것 자체를 증명한다 — level 을 'phase'로 뒀다면 구현이 실수로 level 로 되돌아가도 이 테스트가
// 통과해버려 회귀를 못 잡는다.
function fixtureBarDepth(): ComputedItem[] {
  const task = item({ id: 't1', level: 'custom-task', name: '1-1. 작업', depth: 1 })
  return [item({ id: 'p1', level: 'custom-root', name: '1. 준비', depth: 0, children: [task] })]
}

describe('WBS initialCollapsed', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueWbsCollapse.mockClear() })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('initialCollapsed=[] 이면 기본 접힘을 무시하고 복수담당 부모가 펼쳐진 채 렌더된다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    // 기본값이면 phase+task+act=3행(sub 숨김). initialCollapsed=[] 이면 sub 2개까지 5행.
    expect(rowCount(container)).toBe(5)
  })

  it('initialCollapsed 미지정이면 기존 기본값(복수담당 부모 접힘)을 유지한다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    expect(rowCount(container)).toBe(3)
  })

  it('4단+ 깊이(중간 실 계층 하나 더)에서도 기본 접힘이 복수담당 부모를 찾는다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixtureDeep()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    // 기본값이면 phase+task+세부작업+act=4행(sub 숨김). 얕은 fixture 의 3행보다 중간 계층만큼 늘었을 뿐,
    // multi 는 여전히 접혀야 한다.
    expect(rowCount(container)).toBe(4)
  })

  it('4단+ 깊이에서 initialCollapsed=[] 이면 그대로 전부 펼쳐진다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixtureDeep()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    expect(rowCount(container)).toBe(6)
  })

  it('level 문자열이 activity/phase/task 관례를 따르지 않아도 isOwnerSplit 자식을 가진 노드가 기본 접힘 대상이다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixtureLevelAgnostic()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    // 기본값이면 root+task+중간계층+multi=4행(sub 2개 숨김).
    expect(rowCount(container)).toBe(4)
  })

  it('level 문자열이 관례를 따르지 않아도 initialCollapsed=[] 이면 그대로 전부 펼쳐진다', async () => {
    await act(async () => root.render(
      <WbsGanttSheet items={fixtureLevelAgnostic()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
    expect(rowCount(container)).toBe(6)
  })

  it('Bar — depth 0 은 phase 전용 바 스타일(bg-phasebar)을, depth 1 은 진행 바(bg-plan-track)를 받는다(level 문자열과 무관)', async () => {
    // 회귀 0: D-CUBE에서는 depth 0 이 항상 루트 Phase와 일치하므로(level:'phase'), 이 결과는 구현 이전
    // n.level==='phase' 분기가 내던 스타일과 실데이터 기준으로 동일하다(§4.4). bg-phasebar(굵은 phase 바)
    // vs bg-plan-track(얇은 진행 바)는 육안으로 색·굵기 차이가 나는 스타일이라 최종 확인은 T8 배포 육안
    // 체크리스트 대상 — 이 테스트는 클래스명 수준의 코드 회귀만 잡는다.
    await act(async () => root.render(
      <WbsGanttSheet items={fixtureBarDepth()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />,
    ))
    const phaseRow = container.querySelector('[data-row-id="p1"]')!
    const taskRow = container.querySelector('[data-row-id="t1"]')!
    expect(phaseRow.querySelector('.bg-phasebar')).not.toBeNull()
    expect(phaseRow.querySelector('.bg-plan-track')).toBeNull()
    expect(taskRow.querySelector('.bg-plan-track')).not.toBeNull()
    expect(taskRow.querySelector('.bg-phasebar')).toBeNull()
  })

  it('마운트 시(StrictMode 이중 실행 포함) 저장을 호출하지 않는다', async () => {
    // React StrictMode는 개발 모드에서 마운트 이펙트를 setup→cleanup→setup 두 번 실행한다.
    // 참조 비교 가드는 두 번째 setup에서도 collapsed 가 초기 참조 그대로이므로 저장을 건너뛴다.
    await act(async () => root.render(
      <StrictMode>
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />
      </StrictMode>,
    ))
    expect(queueWbsCollapse).not.toHaveBeenCalled()
  })

  it('사용자가 접힘 토글을 누르면 저장을 정확히 1회 호출한다', async () => {
    await act(async () => root.render(
      <StrictMode>
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly />
      </StrictMode>,
    ))
    expect(queueWbsCollapse).not.toHaveBeenCalled()

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="wbs.expand"]')
    expect(toggle).not.toBeNull()
    await act(async () => toggle!.click())

    expect(queueWbsCollapse).toHaveBeenCalledTimes(1)
    expect(queueWbsCollapse).toHaveBeenCalledWith('p1', expect.any(Array))
  })
})
