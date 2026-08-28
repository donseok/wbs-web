// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'

function item(over: Partial<ComputedItem>): ComputedItem {
  return {
    id: 'x', parentId: null, code: '1', sortOrder: 0, name: '항목',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-10',
    weight: null, actualPct: 0, owners: [], isOwnerSplit: false,
    plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started',
    children: [], depth: 0,
    ...over,
  }
}

/** phase > [단계 im 인 작업, 단계 없는 작업, 모르는 단계 값] */
function fixture(): ComputedItem[] {
  return [item({
    id: 'p1', name: '1. 준비',
    children: [
      item({ id: 't1', name: '단계 있는 작업', stage: 'im' }),
      item({ id: 't2', name: '단계 없는 작업' }),
      item({ id: 't3', name: '모르는 단계', stage: 'zz' }),
    ],
  })]
}

describe('WBS 작업명 칸 우단의 단계 칩', () => {
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
        <WbsGanttSheet items={fixture()} holidays={[]} today="2026-07-03"
          actorView={null} projectId="p1" readOnly />,
      ),
    )
  }

  function chips(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[data-wbs-stage]')]
  }

  it('단계가 있는 행에만 칩이 붙는다 — 없는 행에 빈 자리를 만들지 않는다', async () => {
    await mount()
    // 상위 phase 는 stage 가 없다. 리프 셋 중 둘만.
    expect(chips().map(c => c.dataset.wbsStage)).toEqual(['im', 'zz'])
  })

  it('칩 글자는 단계 코드, 전체 라벨은 title 로 — 좁은 칸에 "구현 완료·검수 대기"가 들어갈 자리가 없다', async () => {
    await mount()
    const im = chips()[0]
    expect(im.textContent).toBe('IM')
    expect(im.getAttribute('title')).toBe('wbs.stageIm')
  })

  it('작업명 칸 안에서 오른쪽 끝으로 밀린다', async () => {
    await mount()
    const im = chips()[0]
    expect(im.closest('[data-wbs-col="name"]')).toBeTruthy()
    // ml-auto 가 빠지면 이름 바로 뒤에 붙는다 — 사용자가 요청한 자리가 아니다.
    expect(im.parentElement!.className).toContain('ml-auto')
    // shrink-0 이 빠지면 긴 이름에 밀려 칩이 찌그러진다.
    expect(im.parentElement!.className).toContain('shrink-0')
  })

  it('모르는 단계 값도 감추지 않는다 — 표시 = 로깅', async () => {
    await mount()
    const unknown = chips()[1]
    expect(unknown.textContent).toBe('ZZ')
  })

  it('글자 크기는 WBS 폰트 조절을 따라간다', async () => {
    await mount()
    expect(chips()[0].style.fontSize).toContain('--wbs-badge-font')
  })
})
