// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MinutesTreeGroup } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const leaf = (id: string, date: string, title: string, extra: Partial<{
  bodyPreview: string; meetingCategory: 'routine' | null; fileCount: number
}> = {}) => ({
  id, minuteDate: date, title, fileCount: 0, createdByName: '홍길동',
  bodyPreview: '', meetingCategory: null as 'routine' | null, ...extra,
})

const groups = [
  {
    teamCode: 'MES', count: 3,
    bodies: [
      { name: '물류공정', count: 2, latestDate: '2026-07-16', leaves: [
        leaf('m1', '2026-07-16', '물류공정_260716', { bodyPreview: '부자재 발주 요약', meetingCategory: 'routine', fileCount: 2 }),
        leaf('m2', '2026-07-09', '물류공정_260709'),
      ] },
      { name: '공정조', count: 1, latestDate: '2026-07-15', leaves: [leaf('m3', '2026-07-15', '공정조_260715')] },
    ],
  },
  {
    teamCode: 'PMO', count: 1,
    bodies: [{ name: '정산', count: 1, latestDate: '2026-07-14', leaves: [leaf('m4', '2026-07-14', '정산_260714')] }],
  },
] as MinutesTreeGroup[]

describe('MinutesExplorer', () => {
  let container: HTMLDivElement, root: Root
  const onToggle = vi.fn(), onRetry = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); onToggle.mockClear(); onRetry.mockClear(); queueUiPref.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer groups={groups} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry} {...over} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }

  it('초기 all 스코프: 사이드바 팀 펼침 + 팀 폴더 카드 + 회의록 카드(요약·유형 칩·회의체 칩)', async () => {
    await mount()
    expect(container.textContent).toContain('min.exp.all')
    expect(container.textContent).toContain('물류공정')            // 사이드바 회의체 행(기본 펼침)
    expect(container.textContent).toContain('min.exp.subfolderCount') // 팀 폴더 카드 메타
    expect(container.textContent).toContain('부자재 발주 요약')       // bodyPreview
    expect(container.textContent).toContain('meet.cat.routine')      // 유형 칩
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
  })

  it('팀 폴더 카드 클릭 → team 스코프(회의체 폴더 카드 + 그 팀 리프만)', async () => {
    await mount()
    // 폴더 카드의 팀명 버튼(사이드바 행과 구분: 카드는 min.exp.meetingCount 메타를 포함)
    const card = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('MES') && b.textContent?.includes('min.exp.meetingCount'))!
    await act(async () => card.click())
    expect(container.textContent).toContain('min.exp.latest')   // 회의체 폴더 카드 메타
    expect(container.querySelector('a[href="/minutes/m4"]')).toBeNull() // PMO 리프 제외
  })

  it('회의체 선택(body 스코프) → 폴더 카드 없음 + 회의체 칩 생략', async () => {
    await mount()
    await act(async () => buttonByText('공정조').click())
    expect(container.querySelector('a[href="/minutes/m3"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()
    expect(container.textContent).not.toContain('min.exp.subfolderCount')
  })

  it('별 토글 클릭 → onToggleFavorite(id) 호출, aria-pressed 반영', async () => {
    await mount()
    const stars = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    const m1star = stars.find(b => b.closest('article')?.textContent?.includes('물류공정_260716'))!
    expect(m1star.getAttribute('aria-pressed')).toBe('true')   // m1 은 즐겨찾기
    await act(async () => m1star.click())
    expect(onToggle).toHaveBeenCalledWith('m1')
  })

  it('즐겨찾기 스코프: fav 리프만 + 카운트, 비면 favEmpty', async () => {
    await mount()
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m2"]')).toBeNull()
    await mount({ favorites: new Set<string>() })
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favEmpty')
  })

  it('favorites=null: 카운트 – 표시, 즐겨찾기 스코프는 에러 카드 + 재시도 콜백', async () => {
    await mount({ favorites: null })
    expect(container.textContent).toContain('–')
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favError')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('더 보기: 30개 초과분은 숨기고 잔여 건수를 라벨에 노출, 클릭 시 확장', async () => {
    const many = [{
      teamCode: 'MES', count: 35,
      bodies: [{ name: '대량', count: 35, latestDate: '2026-07-16',
        leaves: Array.from({ length: 35 }, (_, i) => leaf(`x${i}`, '2026-07-16', `대량_${i}`)) }],
    }] as MinutesTreeGroup[]
    await mount({ groups: many })
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(30)
    expect(container.textContent).toContain('min.exp.more')
    await act(async () => buttonByText('min.exp.more').click())
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(35)
  })

  it('레이아웃 토글 → queueUiPref({minutesExplorerLayout}) + 리스트 행 렌더', async () => {
    await mount()
    await act(async () => buttonByText('min.exp.layout.list').click())
    expect(queueUiPref).toHaveBeenCalledWith({ minutesExplorerLayout: 'list' })
    expect(container.querySelector('article')).toBeNull()   // 카드 대신 행
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
  })

  it('팀 탭 프루닝으로 선택 노드가 사라지면 all 로 강등된다', async () => {
    await mount()
    await act(async () => buttonByText('공정조').click())
    await mount({ groups: [groups[1]] })   // MES 가 사라진 프루닝 결과로 리렌더
    expect(container.querySelector('a[href="/minutes/m4"]')).toBeTruthy() // all 폴백으로 PMO 리프 표시
  })
})
