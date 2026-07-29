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
const moveMinuteFolder = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true }))
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
    onFolderSelect.mockClear(); moveMinuteToFolder.mockClear()
    moveMinuteFolder.mockClear(); moveMinuteFolder.mockResolvedValue({ ok: true })
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set(['m1'])}
        onToggleFavorite={onToggle} onRetryFavorites={onRetry}
        layout="grid"
        currentUserId="u1" isAdmin={false} onChanged={onChanged} onFolderSelect={onFolderSelect}
        teamCodes={['PMO', 'MES', 'ERP']}
        {...over} />,
    ))
  }

  // jsdom 은 DragEvent 를 구현하지 않는다 — bubbles:true 인 일반 Event 에 가짜 dataTransfer 를
  // 붙여 React 루트까지 올려 보낸다(React 는 컨테이너에 위임 리스너를 단다).
  function dragEvent(type: string, dt: Record<string, unknown> = {}): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', {
      value: {
        setData: vi.fn(), getData: vi.fn(() => ''), setDragImage: vi.fn(),
        effectAllowed: '', dropEffect: '', ...dt,
      },
    })
    return ev
  }
  async function dragOver(source: Element, target: Element) {
    await act(async () => { source.dispatchEvent(dragEvent('dragstart')) })
    await act(async () => { target.dispatchEvent(dragEvent('dragover')) })
  }
  async function dragTo(source: Element, target: Element) {
    await dragOver(source, target)
    await act(async () => { target.dispatchEvent(dragEvent('drop')) })
    await act(async () => { source.dispatchEvent(dragEvent('dragend')) })
  }
  function dropTarget(key: string): HTMLElement {
    const found = container.querySelector<HTMLElement>(`[data-drop-target="${key}"]`)
    if (!found) throw new Error(`drop target not found: ${key}`)
    return found
  }
  function cardOf(title: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('article')]
      .find(a => a.textContent?.includes(title))
    if (!found) throw new Error(`card not found: ${title}`)
    return found
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

  /* ── 드래그앤드롭 ── */

  it('회의록을 폴더 행에 드롭하면 moveMinuteToFolder + onChanged', async () => {
    await mount()
    await dragTo(cardOf('미배정 회의록'), dropTarget('f-plan'))
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m3', 'f-plan')
    expect(onChanged).toHaveBeenCalled()
  })

  it('회의록을 미분류 행에 드롭하면 folderId null 로 이동', async () => {
    await mount()
    await dragTo(cardOf('APS 인터뷰'), dropTarget('__unfiled__'))
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m1', null)
  })

  it('제자리(현재 폴더) 드롭은 서버를 부르지 않는다', async () => {
    await mount()
    await dragTo(cardOf('APS 인터뷰'), dropTarget('f-aps'))
    expect(moveMinuteToFolder).not.toHaveBeenCalled()
  })

  it('회의록은 전체(루트) 행에 놓을 수 없다 — 폴더 전용 대상', async () => {
    await mount()
    await dragTo(cardOf('미배정 회의록'), dropTarget('__root__'))
    expect(moveMinuteToFolder).not.toHaveBeenCalled()
    expect(moveMinuteFolder).not.toHaveBeenCalled()
  })

  it('폴더를 다른 폴더에 드롭하면 moveMinuteFolder + 새 부모를 펼쳐 옮긴 폴더가 보인다', async () => {
    // f-pmo 는 처음에 자식이 없어 expanded 에 없다 — 펼치지 않으면 옮긴 폴더가 사라져 보인다
    await mount({ isAdmin: true })
    await dragTo(dropTarget('f-aps'), dropTarget('f-pmo'))
    expect(moveMinuteFolder).toHaveBeenCalledWith('f-aps', 'f-pmo')
    // 재조회 결과(부모가 바뀐 트리)로 다시 렌더 — expanded 상태는 유지된다
    await mount({
      isAdmin: true,
      folders: [folders[0], folders[1], { ...folders[2], parentId: 'f-pmo' }],
    })
    // 레일의 f-aps 행 자체를 확인한다 — 'APS 회의' 텍스트는 카드의 폴더 칩에도 나오므로
    // textContent 로는 접힌 채 사라진 경우를 구분하지 못한다
    expect(container.querySelector('[data-drop-target="f-aps"]')).toBeTruthy()
  })

  it('폴더를 전체(루트) 행에 드롭하면 부모 null 로 이동', async () => {
    await mount()
    await dragTo(dropTarget('f-aps'), dropTarget('__root__'))
    expect(moveMinuteFolder).toHaveBeenCalledWith('f-aps', null)
  })

  it('폴더를 자기 자손에 드롭하면 서버 호출 없이 거부(순환)', async () => {
    await mount()
    await dragTo(dropTarget('f-plan'), dropTarget('f-aps'))
    expect(moveMinuteFolder).not.toHaveBeenCalled()
  })

  it('폴더는 미분류 행에 놓을 수 없다 — 회의록 전용 대상', async () => {
    await mount()
    await dragTo(dropTarget('f-aps'), dropTarget('__unfiled__'))
    expect(moveMinuteFolder).not.toHaveBeenCalled()
  })

  it('권한 없는 항목은 draggable=false — 리프도 폴더도', async () => {
    await mount({ currentUserId: 'other' })
    expect(cardOf('APS 인터뷰').getAttribute('draggable')).not.toBe('true')
    expect(dropTarget('f-plan').getAttribute('draggable')).not.toBe('true')
  })

  it('팀 시드 루트 폴더는 관리자에게도 draggable=false (편철 앵커 보호)', async () => {
    await mount({ isAdmin: true })
    expect(dropTarget('f-pmo').getAttribute('draggable')).not.toBe('true')
    expect(dropTarget('f-plan').getAttribute('draggable')).toBe('true')
  })

  it('dragOver 하이라이트: 수락 대상은 brand, 거부 대상은 delayed', async () => {
    await mount()
    await dragOver(dropTarget('f-aps'), dropTarget('__root__'))
    expect(dropTarget('__root__').className).toContain('ring-brand-ring')
    await mount()
    await dragOver(dropTarget('f-plan'), dropTarget('f-aps'))   // 자손 = 순환 거부
    expect(dropTarget('f-aps').className).toContain('ring-delayed')
  })

  it('회의록 카드의 전면 링크는 draggable=false — 카드 대신 링크가 끌리지 않게', async () => {
    await mount()
    const link = cardOf('APS 인터뷰').querySelector('a[href="/minutes/m1"]')!
    expect(link.getAttribute('draggable')).toBe('false')
  })

  /* ── 드래그 이미지(고스트) ──
     기본 드래그 이미지는 끌고 있는 요소를 통째로 스냅샷한다 — 카드·행이 커서 주변을 덮어
     정작 놓을 곳인 왼쪽 폴더 트리가 가려진다. 그래서 작은 칩으로 바꿔 끈다. */

  function ghostOf(kind: 'leaf' | 'folder'): HTMLElement {
    const found = container.querySelector<HTMLElement>(`[data-drag-ghost="${kind}"]`)
    if (!found) throw new Error(`drag ghost not found: ${kind}`)
    return found
  }
  function labelOf(ghost: HTMLElement): string {
    return ghost.querySelector('[data-drag-ghost-label]')?.textContent ?? ''
  }

  it('그리드 카드를 끌면 카드가 아니라 문서 칩이 드래그 이미지가 된다', async () => {
    await mount()
    const setDragImage = vi.fn()
    await act(async () => {
      cardOf('APS 인터뷰').dispatchEvent(dragEvent('dragstart', { setDragImage }))
    })
    expect(setDragImage).toHaveBeenCalledTimes(1)
    expect(setDragImage.mock.calls[0][0]).toBe(ghostOf('leaf'))
    expect(labelOf(ghostOf('leaf'))).toBe('APS 인터뷰')
  })

  it('리스트 행에서도 같은 문서 칩을 쓴다', async () => {
    await mount({ layout: 'list' })
    const setDragImage = vi.fn()
    const row = [...container.querySelectorAll<HTMLElement>('li')]
      .find(li => li.getAttribute('draggable') === 'true' && li.textContent?.includes('생산계획 정례'))!
    await act(async () => { row.dispatchEvent(dragEvent('dragstart', { setDragImage })) })
    expect(setDragImage.mock.calls[0][0]).toBe(ghostOf('leaf'))
    expect(labelOf(ghostOf('leaf'))).toBe('생산계획 정례')
  })

  it('폴더를 끌면 폴더 칩 + 폴더 이름', async () => {
    await mount()
    const setDragImage = vi.fn()
    await act(async () => {
      dropTarget('f-plan').dispatchEvent(dragEvent('dragstart', { setDragImage }))
    })
    expect(setDragImage.mock.calls[0][0]).toBe(ghostOf('folder'))
    expect(labelOf(ghostOf('folder'))).toBe('생산계획')
  })

  it('고스트는 화면 밖에 상주한다 — DOM 에 없거나 display:none 이면 스냅샷을 못 뜬다', async () => {
    await mount()
    // 레이아웃에 영향을 주지 않으면서(fixed) 스냅샷은 가능한 상태여야 한다
    expect(ghostOf('leaf').className).toContain('fixed')
    expect(ghostOf('leaf').className).not.toContain('hidden')
  })

  it('setDragImage 가 없는 환경에서도 드래그가 깨지지 않는다 — 기본 이미지로 폴백', async () => {
    await mount()
    // dragstart 자체에 setDragImage 가 없는 dataTransfer 를 넘긴다(구형 브라우저·jsdom)
    await act(async () => {
      cardOf('미배정 회의록').dispatchEvent(dragEvent('dragstart', { setDragImage: undefined }))
    })
    await act(async () => { dropTarget('f-plan').dispatchEvent(dragEvent('dragover')) })
    await act(async () => { dropTarget('f-plan').dispatchEvent(dragEvent('drop')) })
    expect(moveMinuteToFolder).toHaveBeenCalledWith('m3', 'f-plan')
  })

  it('서버가 실패를 돌려주면 onChanged 를 부르지 않는다', async () => {
    moveMinuteFolder.mockResolvedValue({ ok: false, error: '권한이 없거나 폴더가 없습니다.' })
    await mount()
    await dragTo(dropTarget('f-aps'), dropTarget('__root__'))
    expect(moveMinuteFolder).toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('왼쪽 메뉴에서 범위를 바꾸면 오른쪽 목록을 맨 위로 되돌린다', async () => {
    await mount()
    const results = container.querySelector<HTMLElement>('[data-minutes-results-scroll-region]')!
    results.scrollTop = 240

    await act(async () => buttonByText('min.exp.favorites').click())

    expect(results.scrollTop).toBe(0)
  })
})
