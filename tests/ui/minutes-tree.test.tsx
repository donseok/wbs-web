// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))

import { MinutesTree } from '@/components/minutes/MinutesTree'

const groups: MinutesTreeGroup[] = [
  {
    teamCode: 'MES', count: 2,
    bodies: [{
      name: '물류공정', count: 2, latestDate: '2026-07-16',
      leaves: [
        { id: 'm1', minuteDate: '2026-07-16', title: '물류공정_260716', fileCount: 1, createdByName: '김철수' },
        { id: 'm2', minuteDate: '2026-07-09', title: '물류공정_260709', fileCount: 0, createdByName: null },
      ],
    }],
  },
  { teamCode: 'PMO', count: 1, bodies: [{ name: '정산', count: 1, latestDate: '2026-07-10', leaves: [
    { id: 'm3', minuteDate: '2026-07-10', title: '정산_260710', fileCount: 0, createdByName: null },
  ] }] },
]

describe('MinutesTree', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  function mount(g: MinutesTreeGroup[] = groups) {
    act(() => root.render(<MinutesTree groups={g} />))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('기본 상태: 레벨1 펼침(회의체 보임), 레벨2 접힘(리프 안 보임)', () => {
    mount()
    expect(container.textContent).toContain('물류공정')
    expect(container.textContent).not.toContain('물류공정_260716')
  })

  it('회의체 클릭 → 리프가 /minutes/{id} 링크로 보인다', () => {
    mount()
    act(() => buttonByText('물류공정').click())
    const link = container.querySelector('a[href="/minutes/m1"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('물류공정_260716')
  })

  it('구분 클릭 → 그 팀 전체가 접힌다(aria-expanded 반영)', () => {
    mount()
    const teamBtn = buttonByText('MES')
    expect(teamBtn.getAttribute('aria-expanded')).toBe('true')
    act(() => teamBtn.click())
    expect(teamBtn.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('물류공정')
  })

  it('전체 펼치기 → 모든 리프 표시, 다시 누르면(전체 접기) 레벨1까지 접힘', () => {
    mount()
    act(() => buttonByText('min.tree.expandAll').click())
    expect(container.querySelector('a[href="/minutes/m1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/minutes/m3"]')).not.toBeNull()
    act(() => buttonByText('min.tree.collapseAll').click())
    expect(container.textContent).not.toContain('물류공정')  // 레벨2 이하 안 보임
    expect(container.textContent).toContain('MES')            // 레벨1 행 자체는 보임
  })
})
