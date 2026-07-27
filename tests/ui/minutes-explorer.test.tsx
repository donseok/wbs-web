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
const moveMinuteFolder = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteToFolder: (...a: unknown[]) => moveMinuteToFolder(...(a as [])),
  moveMinuteFolder: (...a: unknown[]) => moveMinuteFolder(...(a as [])),
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
  const onToggle = vi.fn(), onRetry = vi.fn(), onChanged = vi.fn(), onFolderSelect = vi.fn()
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onToggle.mockClear(); onRetry.mockClear(); onChanged.mockClear()
    onFolderSelect.mockClear(); moveMinuteToFolder.mockClear(); moveMinuteFolder.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry}
        layout="grid"
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
  /** 레일의 폴더 행(div.group) — 드래그 핸들이자 드롭존. 하위 ul 은 형제 li 라 섞이지 않는다. */
  function folderRowEl(name: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('[data-minutes-navigation] .group')]
      .find(d => d.textContent?.includes(name))
    if (!found) throw new Error(`folder row not found: ${name}`)
    return found
  }
  function articleByText(text: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('article')].find(a => a.textContent?.includes(text))
    if (!found) throw new Error(`article not found: ${text}`)
    return found
  }
  // jsdom 에는 DragEvent 도 DataTransfer 도 없다. React 는 nativeEvent.dataTransfer 를 그대로
  // 넘기므로 최소 구현만 붙이면 합성 이벤트가 성립한다.
  function makeDataTransfer() {
    const store = new Map<string, string>()
    return {
      dropEffect: 'none', effectAllowed: 'none',
      setData: (k: string, v: string) => { store.set(k, v) },
      getData: (k: string) => store.get(k) ?? '',
    } as unknown as DataTransfer
  }
  function fireDrag(el: Element, type: string, dataTransfer: DataTransfer): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer })
    el.dispatchEvent(ev)
    return ev
  }

  // D&D 판정 검증용 폴더 세트 — 시드 팀 루트(createdBy null) 밑에만 팀 파생이 성립한다(§6.3).
  const dndFolders = [
    folder('f-mes', 'MES', null, 0),
    folder('f-erp', 'ERP', null, 1),
    folder('f-q', '품질', 'f-mes', 0, 'u1'),
    folder('f-w', '주간정례', 'f-q', 0, 'u1'),
    folder('f-prod', '생산계획', 'f-mes', 1, 'u1'),
  ]

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

  it('W18: 루트 새 폴더 버튼이 없다 — 루트 생성이 거절되므로 죽은 어포던스', async () => {
    await mount({ isAdmin: true })
    // 폴더는 팀 폴더 ⋯ 메뉴의 '하위 폴더 추가'로만 만든다(§6.3 불변식)
    const found = [...container.querySelectorAll('button')]
      .filter(b => (b.textContent ?? '').includes('min.fold.new'))
    expect(found).toHaveLength(0)
  })

  it('하위 폴더 추가는 ⋯ 메뉴에서 열린다 — 상위 폴더가 정해진 생성만 가능', async () => {
    await mount({ isAdmin: true })
    const menuBtn = container.querySelector<HTMLButtonElement>('button[aria-label="min.fold.menuAria"]')!
    await act(async () => menuBtn.click())
    await act(async () => buttonByText('min.fold.addSub').click())
    expect(dialog().textContent).toContain('min.fold.name')          // FolderManageModal
  })

  it('이동 버튼 → 픽커 열림 후 폴더 선택 시 moveMinuteToFolder 호출·onChanged', async () => {
    await mount()
    const moveBtn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="min.fold.move"]')]
      .find(b => b.closest('article')?.textContent?.includes('APS 인터뷰'))!
    await act(async () => moveBtn.click())
    expect(dialog().textContent).toContain('min.fold.pickTitle')
    // §6.4: 픽커에 미분류 항목이 없다 — 폴더에서 빼는 조작은 제공하지 않는다
    expect(dialog().textContent).not.toContain('min.fold.unfiled')
    await act(async () => dialogButtonByText('APS 회의').click())
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m1', 'f-aps')
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

  it('더 보기 30개 증분 유지', async () => {
    const many = Array.from({ length: 35 }, (_, i) => leaf(`x${i}`, '2026-07-01', `대량_${i}`, null))
    await mount({ leaves: many, folders: [] })
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(30)
    await act(async () => buttonByText('min.exp.more').click())
    expect(container.querySelectorAll('a[href^="/minutes/x"]').length).toBe(35)
  })

  it.each(['grid', 'list'] as const)(
    '%s 보기: 내부 경로·보기 전환 행 없이 결과가 우측 열 맨 위에서 시작한다',
    async layout => {
      await mount({ layout })

      const contentBody = container.querySelector<HTMLElement>('[data-minutes-content-body]')

      expect(container.querySelector('[data-minutes-content-header]')).toBeNull()
      expect(contentBody?.parentElement?.firstElementChild).toBe(contentBody)
      expect(contentBody?.parentElement?.children).toHaveLength(1)
      expect(contentBody?.parentElement?.querySelector('[role="tablist"]')).toBeNull()
      expect(contentBody?.classList).not.toContain('mt-4')
      expect(contentBody?.classList).not.toContain('lg:mt-0.5')
      expect(contentBody?.classList).toContain('space-y-4')
    },
  )

  it('데스크톱은 왼쪽 탐색 메뉴를 고정하고 오른쪽 결과 영역만 독립 스크롤한다', async () => {
    await mount()

    const explorer = container.querySelector<HTMLElement>('[data-minutes-explorer]')
    const navigation = container.querySelector<HTMLElement>('[data-minutes-navigation]')
    const results = container.querySelector<HTMLElement>('[data-minutes-results-scroll-region]')

    expect(explorer?.classList).toContain('lg:min-h-0')
    expect(explorer?.classList).toContain('lg:items-stretch')
    expect(navigation?.classList).toContain('lg:overflow-y-auto')
    expect(results?.classList).toContain('lg:min-h-0')
    expect(results?.classList).toContain('lg:overflow-y-auto')
    expect(results?.classList).toContain('lg:overscroll-y-contain')
  })

  it('왼쪽 메뉴에서 범위를 바꾸면 오른쪽 목록을 맨 위로 되돌린다', async () => {
    await mount()
    const results = container.querySelector<HTMLElement>('[data-minutes-results-scroll-region]')!
    results.scrollTop = 240

    await act(async () => buttonByText('min.exp.favorites').click())

    expect(results.scrollTop).toBe(0)
  })

  /* ── D&D (§6 W22) ── */

  it('폴더 드래그는 관리자만 — 시드 팀 루트는 draggable 자체가 없다(§6.8)', async () => {
    await mount({ folders: dndFolders, leaves: [], isAdmin: false })
    expect(container.querySelectorAll('[data-minutes-navigation] [draggable="true"]').length).toBe(0)

    await mount({ folders: dndFolders, leaves: [], isAdmin: true })
    expect(folderRowEl('품질').getAttribute('draggable')).toBe('true')
    expect(folderRowEl('주간정례').getAttribute('draggable')).toBe('true')
    expect(folderRowEl('MES').getAttribute('draggable')).toBe('false')
    expect(folderRowEl('ERP').getAttribute('draggable')).toBe('false')
  })

  it('회의록 카드는 이동 권한이 있을 때만 draggable, 전면 Link 는 draggable=false', async () => {
    await mount()
    const card = articleByText('APS 인터뷰')
    expect(card.getAttribute('draggable')).toBe('true')
    // Link 가 기본 draggable 이면 오버레이가 드래그를 가로채 URL(text/uri-list)이 실려 나간다
    expect(card.querySelector('a')?.getAttribute('draggable')).toBe('false')

    await mount({ layout: 'list' })
    const row = [...container.querySelectorAll<HTMLElement>('li')].find(li => li.textContent?.includes('APS 인터뷰'))!
    expect(row.getAttribute('draggable')).toBe('true')
    expect(row.querySelector('a')?.getAttribute('draggable')).toBe('false')

    await mount({ currentUserId: 'other' })
    expect(articleByText('APS 인터뷰').getAttribute('draggable')).toBe('false')
  })

  it('폴더 드롭존: 받을 수 있는 폴더만 preventDefault + 하이라이트, 드롭 시 moveMinuteFolder', async () => {
    await mount({ folders: dndFolders, leaves: [], isAdmin: true })
    const dt = makeDataTransfer()
    await act(async () => { fireDrag(folderRowEl('품질'), 'dragstart', dt) })

    // 자기 자손(주간정례)·현재 부모(MES)·다른 팀(ERP)은 모두 드롭 불가 → preventDefault 없음
    for (const name of ['주간정례', 'MES', 'ERP']) {
      const ev = fireDrag(folderRowEl(name), 'dragover', dt)
      expect(ev.defaultPrevented, name).toBe(false)
      expect(folderRowEl(name).className).not.toContain('border-brand')
    }

    // 같은 팀·깊이 여유 있는 형제(생산계획)만 허용
    let ok: Event
    await act(async () => { ok = fireDrag(folderRowEl('생산계획'), 'dragover', dt) })
    expect(ok!.defaultPrevented).toBe(true)
    expect(folderRowEl('생산계획').className).toContain('border-brand')
    expect(folderRowEl('생산계획').className).toContain('ring-brand-ring')

    await act(async () => { fireDrag(folderRowEl('생산계획'), 'drop', dt) })
    expect(moveMinuteFolder).toHaveBeenCalledWith('f-q', 'f-prod')
    expect(onChanged).toHaveBeenCalled()
  })

  it('회의록 드롭: 폴더 행에 놓으면 moveMinuteToFolder — 같은 폴더는 드롭존 비활성', async () => {
    const ls = [leaf('m9', '2026-07-22', '품질 정례', 'f-q')]
    await mount({ folders: dndFolders, leaves: ls, isAdmin: false })
    const dt = makeDataTransfer()
    await act(async () => { fireDrag(articleByText('품질 정례'), 'dragstart', dt) })

    const same = fireDrag(folderRowEl('품질'), 'dragover', dt)
    expect(same.defaultPrevented).toBe(false)          // 이미 그 폴더 소속 = 이동 아님

    let ok: Event
    await act(async () => { ok = fireDrag(folderRowEl('생산계획'), 'dragover', dt) })
    expect(ok!.defaultPrevented).toBe(true)
    await act(async () => { fireDrag(folderRowEl('생산계획'), 'drop', dt) })
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m9', 'f-prod')
  })

  it('이동 권한이 없는 회의록은 어떤 폴더도 드롭을 받지 않는다', async () => {
    const ls = [leaf('m9', '2026-07-22', '품질 정례', 'f-q')]
    await mount({ folders: dndFolders, leaves: ls, isAdmin: false, currentUserId: 'other' })
    const dt = makeDataTransfer()
    // draggable 이 아니라 dragstart 자체가 없지만, 상태가 없을 때 드롭존이 열리지 않는지 확인
    const ev = fireDrag(folderRowEl('생산계획'), 'dragover', dt)
    expect(ev.defaultPrevented).toBe(false)
    expect(articleByText('품질 정례').getAttribute('draggable')).toBe('false')
  })
})
