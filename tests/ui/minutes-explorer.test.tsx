// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerLeaf, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const moveMinuteToFolder = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteToFolder: (...a: unknown[]) => moveMinuteToFolder(...(a as [])),
}))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const folder = (id: string, name: string, parentId: string | null = null, sort = 100, createdBy: string | null = null): MinuteFolder =>
  ({ id, name, parentId, sort, createdBy })
const leaf = (id: string, date: string, title: string, folderId: string | null, extra: Partial<ExplorerLeaf> = {}): ExplorerLeaf => ({
  id, minuteDate: date, teamCode: 'MES', title, fileCount: 0,
  createdBy: 'u1', createdByName: '홍길동', bodyPreview: '', meetingCategory: null,
  folderId, ...extra,
})

const folders = [
  folder('f-pmo', 'PMO', null, 0),
  folder('f-plan', '생산계획', null, 5, 'u1'),  // 일반(사용자) 폴더 — 루트 시드는 팀 앵커로 보호됨
  folder('f-aps', 'APS 회의', 'f-plan', 100, 'u1'),
]
const leaves = [
  leaf('m1', '2026-07-22', 'APS 인터뷰', 'f-aps', { bodyPreview: '부자재 발주 요약', meetingCategory: 'routine' }),
  leaf('m2', '2026-07-21', '생산계획 정례', 'f-plan'),
  leaf('m3', '2026-07-20', '미배정 회의록', null),
]

describe('MinutesExplorer v2 (폴더 디렉토리)', () => {
  let container: HTMLDivElement, root: Root
  const onToggle = vi.fn(), onRetry = vi.fn(), onLayout = vi.fn(), onChanged = vi.fn(), onFolderSelect = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onToggle.mockClear(); onRetry.mockClear(); onLayout.mockClear(); onChanged.mockClear()
    onFolderSelect.mockClear(); moveMinuteToFolder.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry}
        layout="grid" onLayoutChange={onLayout}
        currentUserId="u1" isAdmin={false} onChanged={onChanged} onFolderSelect={onFolderSelect}
        {...over} />,
    ))
  }
  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`button not found: ${text}`)
    return found
  }
  // Modal은 createPortal(..., document.body)로 container 밖에 렌더된다(다른 스위트의 확립된 관례 —
  // tests/ui/modal-focus.test.tsx, tests/ui/deep-link-params.test.tsx도 document.querySelector('[role="dialog"]')
  // 로 모달을 찾는다). container 스코프 헬퍼로는 모달 내부 버튼/텍스트를 관찰할 수 없어 별도 헬퍼가 필요하다.
  function dialog(): HTMLElement {
    const found = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!found) throw new Error('dialog not found')
    return found
  }
  function dialogButtonByText(text: string): HTMLButtonElement {
    const found = [...dialog().querySelectorAll('button')].find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`dialog button not found: ${text}`)
    return found
  }

  it('all 스코프: 폴더 카드 그리드 없이 전체 리프 flat — 탐색은 레일(카드 제거, 사용자 결정)', async () => {
    await mount()
    // 전체 flat: 3건 모두 렌더
    expect(container.querySelectorAll('a[href^="/minutes/m"]').length).toBe(3)
    // 루트 카드 그리드 제거 — 카드 전용 문구(meetingCount)가 전체 스코프에 없다
    expect(container.textContent).not.toContain('min.exp.meetingCount')
    // 폴더·미분류는 레일에서 여전히 접근 가능
    expect(container.textContent).toContain('PMO')
    expect(container.textContent).toContain('min.fold.unfiled')
  })

  it('폴더 스코프: 직계 리프만 표시, 하위 폴더 진입은 레일로(카드 없음)', async () => {
    await mount()
    await act(async () => buttonByText('생산계획').click())   // 레일 행(첫 매치)
    expect(container.querySelector('a[href="/minutes/m2"]')).toBeTruthy()   // 직계
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()     // 하위 폴더 소속은 미표시
    expect(container.textContent).not.toContain('min.exp.meetingCount')     // 하위 폴더 카드 없음
    await act(async () => buttonByText('APS 회의').click())                  // 레일의 하위 폴더 행
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeTruthy()
    expect(onFolderSelect).toHaveBeenLastCalledWith('f-aps')
  })

  it('미분류 스코프: folder_id null 리프만', async () => {
    await mount()
    await act(async () => buttonByText('min.fold.unfiled').click())
    expect(container.querySelector('a[href="/minutes/m3"]')).toBeTruthy()
    expect(container.querySelector('a[href="/minutes/m1"]')).toBeNull()
    expect(onFolderSelect).toHaveBeenLastCalledWith(null)
  })

  it('미분류 0건이면 레일 행·전체 카드 모두 숨김 (0043 자동 편철 후 평시 상태)', async () => {
    await mount({ leaves: leaves.filter(l => l.folderId !== null) })
    expect(container.textContent).not.toContain('min.fold.unfiled')
  })

  it('미분류 스코프에서 마지막 1건이 빠져도 레일 행은 유지된다(발 디딜 곳)', async () => {
    await mount()
    await act(async () => buttonByText('min.fold.unfiled').click())
    await mount({ leaves: leaves.filter(l => l.folderId !== null) })   // 재렌더: 미분류 0건
    expect(container.textContent).toContain('min.fold.unfiled')
  })

  it('팀 기본 폴더(PMO)는 관리자 메뉴에서도 개명·삭제 숨김 — 하위 폴더 추가만(0043)', async () => {
    await mount({ isAdmin: true })
    const menuBtn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="min.fold.menuAria"]')]
      .find(b => b.closest('li')?.textContent?.includes('PMO'))!
    await act(async () => menuBtn.click())
    const li = menuBtn.closest('li')!
    expect(li.textContent).toContain('min.fold.addSub')
    expect(li.textContent).not.toContain('min.fold.rename')
    expect(li.textContent).not.toContain('min.fold.delete')
    // 일반 폴더(생산계획)는 개명·삭제 유지
    const planBtn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="min.fold.menuAria"]')]
      .find(b => b.closest('li')?.textContent?.includes('생산계획'))!
    await act(async () => planBtn.click())
    expect(planBtn.closest('li')!.textContent).toContain('min.fold.rename')
  })

  it('시드 하위 구분(품질)은 개명·삭제 노출 — 하위 구분이 실폴더 동적 유도로 바뀌어 앵커 보호 해제', async () => {
    const fs = [folder('f-mes', 'MES', null, 2), folder('f-q', '품질', 'f-mes', 0)]
    await mount({ isAdmin: true, folders: fs, leaves: [] })
    // 품질 자신의 행 li(중첩 안쪽)만 매칭 — MES 행 li 는 하위 li 를 포함하므로 'MES' 부재로 가른다
    const qBtn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="min.fold.menuAria"]')]
      .find(b => b.closest('li')?.textContent?.includes('품질') && !b.closest('li')?.textContent?.includes('MES'))!
    await act(async () => qBtn.click())
    const li = qBtn.closest('li')!
    expect(li.textContent).toContain('min.fold.addSub')
    expect(li.textContent).toContain('min.fold.rename')
    expect(li.textContent).toContain('min.fold.delete')
  })

  it('폴더 ⋯ 메뉴는 소유자/관리자에게만 — 시드 폴더는 일반 사용자에게 숨김', async () => {
    await mount()
    // 시드(createdBy null) PMO 행: 메뉴 없음 / 본인 소유 생산계획·APS 회의: 메뉴 있음
    const menuBtns = [...container.querySelectorAll('button[aria-label="min.fold.menuAria"]')]
    expect(menuBtns.length).toBe(2)
    await mount({ isAdmin: true })
    expect([...container.querySelectorAll('button[aria-label="min.fold.menuAria"]')].length).toBe(3)
  })

  it('새 폴더 버튼 → 생성 모달 열림, 이동 버튼 → 픽커 열림 후 moveMinuteToFolder 호출·onChanged', async () => {
    await mount()
    await act(async () => buttonByText('min.fold.new').click())
    expect(dialog().textContent).toContain('min.fold.name')          // FolderManageModal
    await act(async () => dialogButtonByText('min.fold.cancel').click())  // 없으면 Esc 대체 — 구현의 닫기 버튼 텍스트에 맞춤
    // 이동: m1 카드의 이동 버튼(작성자 u1)
    const moveBtn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="min.fold.move"]')]
      .find(b => b.closest('article')?.textContent?.includes('APS 인터뷰'))!
    await act(async () => moveBtn.click())
    expect(dialog().textContent).toContain('min.fold.pickTitle')
    await act(async () => dialogButtonByText('min.fold.unfiled').click())   // 픽커에서 미분류 선택
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m1', null)
    expect(onChanged).toHaveBeenCalled()
  })

  it('이동 버튼은 작성자가 아니고 관리자도 아니면 없다', async () => {
    await mount({ currentUserId: 'other' })
    expect(container.querySelectorAll('button[aria-label="min.fold.move"]').length).toBe(0)
  })

  it('선택 폴더가 사라지면(재조회 후) all 강등', async () => {
    await mount()
    await act(async () => buttonByText('APS 회의').click())
    await mount({ folders: [folders[0], folders[1]], leaves })  // f-aps 삭제된 재조회 결과
    expect(container.querySelectorAll('a[href^="/minutes/m"]').length).toBe(3)  // all flat
  })

  it('즐겨찾기·팀 필터 계약 유지: favorites=null 카운트 –, 즐겨찾기 스코프 에러 카드+재시도', async () => {
    await mount({ favorites: null })
    expect(container.textContent).toContain('–')
    await act(async () => buttonByText('min.exp.favorites').click())
    expect(container.textContent).toContain('min.exp.favError')
    await act(async () => buttonByText('min.tree.retry').click())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('더 보기 30개 증분과 레이아웃 콜백 유지', async () => {
    const many = Array.from({ length: 35 }, (_, i) => leaf(`x${i}`, '2026-07-01', `대량_${i}`, null))
    await mount({ leaves: many, folders: [] })
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(30)
    await act(async () => buttonByText('min.exp.more').click())
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(35)
    await act(async () => buttonByText('min.exp.layout.list').click())
    expect(onLayout).toHaveBeenCalledWith('list')
  })
})
