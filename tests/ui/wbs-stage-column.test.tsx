// @vitest-environment jsdom
// 「단계」 컬럼(스펙 2026-09-15 D9): 에이전트 위임(agent 태그) 항목이 하나라도 있는 프로젝트에만 뜬다 —
// 담당자 컬럼(hasAssignee)과 같은 규칙이라 위임이 없는 D-CUBE 는 표가 그대로다.
// 작업명 칸 우단에 있던 단계 칩은 이 컬럼으로 옮겼다(같은 값이 두 번 보이지 않게).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import { wbsKo } from '@/lib/i18n/dict/wbs'
import { wbsEn } from '@/lib/i18n/dict/wbs.en'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn(), queueUiPref: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return { id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목', biz: null, deliverable: null,
    plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: null, actualPct: 0, owners: [], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0, ...over }
}

describe('WBS 사전 — 단계 컬럼 헤더', () => {
  it('ko 「단계」· en "Stage"', () => {
    expect(wbsKo['wbs.colStage']).toBe('단계')
    expect(wbsEn['wbs.colStage']).toBe('Stage')
  })
})

describe('WBS 「단계」 컬럼', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function render(items: ComputedItem[]) {
    await act(async () => root.render(
      <WbsGanttSheet items={items} holidays={[]} today="2026-07-03" actorView={null} projectId="p1" readOnly initialCollapsed={[]} />,
    ))
  }
  const header = () => container.querySelector<HTMLElement>('[data-wbs-col="stage"][data-wbs-col-kind="header"]')
  const cell = (id: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-wbs-col="stage"]`)

  it('위임 항목이 하나도 없으면 컬럼도, 작업명 칸 칩도 없다', async () => {
    await render([item({ id: 'a1', stage: 'im' })])
    expect(header()).toBeNull()
    expect(cell('a1')).toBeNull()
    expect(container.querySelector('[data-wbs-stage]')).toBeNull()
  })

  it('위임 항목이 하나라도 있으면 컬럼이 뜨고, 단계 칩·미지정 - 를 그린다', async () => {
    await render([
      item({ id: 'a1', stage: 'im', agentDelegated: true }),
      item({ id: 'a2' }),
      item({ id: 'a3', stage: 'zz' }),
    ])
    expect(header()!.textContent).toContain('wbs.colStage')
    const chip = cell('a1')!.querySelector<HTMLElement>('[data-wbs-stage]')!
    expect(chip.dataset.wbsStage).toBe('im')
    expect(chip.textContent).toBe('IM')                    // 칩은 코드 대문자(스펙 §3.2), 라벨은 title
    expect(chip.getAttribute('title')).toBe('wbs.stageIm')
    expect(cell('a2')!.textContent).toBe('-')
    expect(cell('a3')!.textContent).toBe('ZZ')             // 모르는 코드도 감추지 않는다(표시 = 로깅)
    expect(container.querySelector('[data-wbs-col="name"] [data-wbs-stage]')).toBeNull()
  })

  it('깊은 자손에만 위임이 있어도 컬럼이 뜬다(재귀 판정)', async () => {
    const leaf = item({ id: 'c1', agentDelegated: true })
    await render([item({ id: 'a1', children: [item({ id: 'b1', children: [leaf] })] })])
    expect(header()).not.toBeNull()
  })

  it('진척 컬럼 바로 뒤에 온다', async () => {
    await render([item({ id: 'a1', agentDelegated: true })])
    const heads = [...container.querySelectorAll<HTMLElement>('[data-wbs-col-kind="header"]')].map(h => h.dataset.wbsCol)
    expect(heads.indexOf('stage')).toBe(heads.indexOf('status') + 1)
  })
})
