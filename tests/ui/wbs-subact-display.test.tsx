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

/** phase > task > [복수 담당 act(sub-act 3개: 정상 2 + 개명 1), 단일 담당 act] */
function fixture(): ComputedItem[] {
  const parentName = 'CBO 개발 프로그램 사용 현황 분석'
  const subs = [
    item({ id: 's1', parentId: 'a1', name: `${parentName} (가공 주관)`, owners: [{ team: '가공', kind: 'primary' }] }),
    item({ id: 's2', parentId: 'a1', name: `${parentName} (ERP 주관)`, owners: [{ team: 'ERP', kind: 'primary' }] }),
    item({ id: 's3', parentId: 'a1', name: '수동으로 바꾼 이름', owners: [{ team: 'MES', kind: 'support' }] }),
  ]
  const multi = item({
    id: 'a1', name: parentName,
    owners: [
      { team: '가공', kind: 'primary' },
      { team: 'ERP', kind: 'primary' },
      { team: 'MES', kind: 'support' },
    ],
    children: subs,
  })
  const single = item({ id: 'a2', name: '단일 담당 작업', owners: [{ team: '가공', kind: 'primary' }] })
  const task = item({ id: 't1', level: 'task', name: '1-1. 작업', children: [multi, single] })
  return [item({ id: 'p1', level: 'phase', name: '1. 준비', children: [task] })]
}

describe('WBS sub-act 축약 표시 + 기본 접힘', () => {
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

  function rowNames(): string[] {
    return [...container.querySelectorAll<HTMLElement>('.group.relative.z-10')].map(
      r => r.querySelector<HTMLElement>('button[title]')?.textContent ?? '',
    )
  }

  it('복수 담당 부모는 기본 접힘 — 첫 화면에 sub-act 가 보이지 않는다', async () => {
    await mount()
    const names = rowNames()
    expect(names).toHaveLength(4) // phase + task + act 2 (sub-act 3개 숨김)
    expect(names.join('|')).not.toContain('주관')
  })

  it('펼치면 sub-act 는 부모명 접두를 뗀 축약명으로, 개명된 항목은 풀네임으로 보인다', async () => {
    await mount()
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="wbs.expand"]')]
    expect(toggle.length).toBeGreaterThan(0)
    await act(async () => toggle[0].click())

    const names = rowNames()
    expect(names).toHaveLength(7)
    expect(names).toContain('└가공 주관')
    expect(names).toContain('└ERP 주관')
    expect(names).toContain('└수동으로 바꾼 이름') // 접두 불일치 → 풀네임 폴백
    // 부모 행은 원본 이름 그대로 1회만
    expect(names.filter(n => n === 'CBO 개발 프로그램 사용 현황 분석')).toHaveLength(1)
  })

  it('hover title 은 풀네임을 유지한다(검색·식별용 저장 이름 불변)', async () => {
    await mount()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="wbs.expand"]')!.click()
    })
    const titles = [...container.querySelectorAll<HTMLElement>('.group.relative.z-10 button[title]')].map(
      b => b.getAttribute('title') ?? '',
    )
    expect(titles.some(t => t.startsWith('CBO 개발 프로그램 사용 현황 분석 (가공 주관)'))).toBe(true)
  })
})
