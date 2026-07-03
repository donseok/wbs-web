// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

// react-dom/client의 act를 쓰려면 필요한 플래그.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 서버 액션·supabase 의존 모듈은 jsdom에서 실행 불가 — 경계만 모킹.
vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(),
  updateWeight: vi.fn(),
  addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

const ROW_H = 40

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x',
    parentId: null,
    level: 'activity',
    code: '1',
    sortOrder: 0,
    name: '항목',
    biz: null,
    deliverable: null,
    plannedStart: '2026-07-01',
    plannedEnd: '2026-07-10',
    weight: null,
    actualPct: 0,
    owners: [],
    plannedPct: 0,
    rolledActualPct: 0,
    achievement: null,
    status: 'not_started',
    children: [],
    ...over,
  }
}

/** phase(담당 없음) 아래 task 2개: 단일 담당 / 3팀 담당 */
function fixture(): ComputedItem[] {
  const single = item({ id: 't1', level: 'task', name: '1-1. 단일 담당 작업', owners: [{ team: 'PMO', kind: 'primary' }] })
  const multi = item({
    id: 't2',
    level: 'task',
    name: '1-2. 복수 담당 작업',
    owners: [
      { team: 'DT', kind: 'primary' },
      { team: 'ERP', kind: 'primary' },
      { team: 'MES', kind: 'support' },
    ],
  })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [single, multi] })]
}

describe('WBS 담당별 행 분리', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount() {
    await act(async () =>
      root.render(
        <WbsGanttSheet
          items={fixture()}
          holidays={[]}
          today="2026-07-03"
          membership={null}
          projectId="p1"
          readOnly
        />,
      ),
    )
  }

  it('복수 담당 항목은 담당 수만큼 행 높이가 늘고 작업명은 한 번만 보인다(셀 병합)', async () => {
    await mount()
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows).toHaveLength(3) // phase + task 2 — 항목(행 그룹) 수는 그대로

    const heights = rows.map(r => r.style.height)
    expect(heights).toEqual([`${ROW_H}px`, `${ROW_H}px`, `${ROW_H * 3}px`])

    // 작업명은 항목당 1회(병합 표시)
    expect(container.querySelectorAll('[title*="1-2. 복수 담당 작업"]')).toHaveLength(1)
  })

  it('복수 담당 항목의 담당 셀은 팀별 칸으로 분리되어 각 칸에 팀 하나씩 표시된다', async () => {
    await mount()
    const multiRow = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')][2]
    const badges = [...multiRow.querySelectorAll('span')]
      .map(s => s.textContent)
      .filter(t => t === 'DT' || t === 'ERP' || t === 'MES')
    expect(badges).toEqual(['DT', 'ERP', 'MES'])

    // 팀별 칸 사이 구분선: 3칸 중 마지막을 제외한 2칸에 border-b
    const subRows = [...multiRow.querySelectorAll<HTMLElement>('div')].filter(d =>
      d.style.height === `${ROW_H}px` && d.className.includes('border-b'),
    )
    expect(subRows).toHaveLength(2)
  })

  it('담당 없는 항목은 한 칸으로 유지되고 배경 격자 높이는 분리 행 합계와 일치한다', async () => {
    await mount()
    const rows = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')]
    expect(rows[0].style.height).toBe(`${ROW_H}px`) // phase: 담당 없음 → 1칸
    expect(rows[0].textContent).toContain('-')

    // 배경 격자(오늘선과 동일 높이 소스) = 40 + 40 + 120 = 200px
    const grid = container.querySelector<HTMLElement>('.pointer-events-none.absolute.z-0')!
    expect(grid.style.height).toBe(`${ROW_H * 5}px`)
  })
})
