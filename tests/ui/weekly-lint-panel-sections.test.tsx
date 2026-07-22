// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WeeklyLintPanel } from '@/components/weekly/WeeklyLintPanel'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mkRow = (id: string, section: string, sortOrder: number, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id, reportId: 'rep', section, module: '', sortOrder,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

const sections = () =>
  [...document.querySelectorAll<HTMLElement>('[data-lint-section]')]

describe('주간보고 점검 패널 — 구분 단위', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  const show = (rows: WeeklySheetRow[]) => {
    root = createRoot(container)
    act(() => root.render(
      <WeeklyLintPanel open rows={rows} onClose={() => {}} onApply={() => {}} onGoToCell={() => {}} />,
    ))
  }

  it('지적을 구분별로 묶어 구분 순서대로 보여준다', () => {
    show([
      mkRow('r2', '영업', 2, { thisContent: '나  ' }),
      mkRow('r1', 'PMO', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
    ])
    expect(sections().map(el => el.dataset.lintSection)).toEqual(['PMO', '영업'])
  })

  it('구분 묶음 안에는 그 구분의 지적만 들어간다', () => {
    show([
      mkRow('r1', 'PMO', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '나  ' }),
    ])
    const counts = sections().map(el => el.querySelectorAll('li').length)
    expect(counts).toEqual([2, 1])
  })

  it('묶음 머리글에 구분 이름과 건수가 보인다', () => {
    show([
      mkRow('r1', 'PMO', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '나  ' }),
    ])
    const heads = sections().map(el => el.querySelector('h3')!.textContent ?? '')
    expect(heads[0]).toContain('PMO')
    expect(heads[0]).toContain('2건')
    expect(heads[1]).toContain('영업')
    expect(heads[1]).toContain('1건')
  })

  it('앞 구분에 정리 지적만 있어도 구분 순서가 뒤집히지 않는다', () => {
    show([
      mkRow('r1', 'PMO', 1, { thisContent: '가  나' }),   // 정리 지적만
      mkRow('r2', '영업', 2, { thisContent: '다\n다' }),  // 중복 지적
    ])
    expect(sections().map(el => el.dataset.lintSection)).toEqual(['PMO', '영업'])
  })

  it('지적이 없으면 구분 묶음도 없다', () => {
    show([mkRow('r1', 'PMO', 1, { thisContent: '가\n나' })])
    expect(sections()).toHaveLength(0)
    expect(document.body.textContent).toContain('점검할 내용이 없습니다')
  })

  it('적용 버튼은 그 지적의 편집을 그대로 넘긴다', () => {
    const got: unknown[] = []
    root = createRoot(container)
    act(() => root.render(
      <WeeklyLintPanel
        open
        rows={[mkRow('r1', 'PMO', 1, { thisContent: '가\n가' })]}
        onClose={() => {}}
        onApply={edits => got.push(edits)}
        onGoToCell={() => {}}
      />,
    ))
    const apply = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '적용')!
    act(() => apply.click())
    expect(got).toEqual([[{ rowId: 'r1', cellKey: 'this_content', content: '가' }]])
  })
})
