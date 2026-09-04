// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ExplorerLeaf, Minute, MinuteFolder } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}))
const toast = vi.fn()
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

const fetchMinuteDetail = vi.fn<(id: string) => Promise<{ minute: Minute; files: [] } | null>>()
const deleteMinute = vi.fn<(id: string) => Promise<{ ok: boolean; error?: string }>>()
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinute: (id: string) => deleteMinute(id),
  moveMinuteToFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteFolder: vi.fn(async () => ({ ok: true })),
  fetchMinuteDetail: (id: string) => fetchMinuteDetail(id),
}))
// 메타 모달 자체는 별도 스위트(minute-meta-modal)가 검증한다 — 여기서는 "열렸는가 + 어떤
// 회의록으로 열렸는가"만 본다. 실물을 쓰면 폴더 재조회 effect 까지 끌려온다.
vi.mock('@/components/minutes/MinuteMetaModal', () => ({
  MinuteMetaModal: ({ minute, onSaved }: { minute: Minute; onSaved: () => void }) => (
    <div data-testid="meta-modal">
      <span data-testid="meta-title">{minute.title}</span>
      <button onClick={onSaved}>저장됨</button>
    </div>
  ),
}))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const folders: MinuteFolder[] = [
  { id: 'f-plan', name: '생산계획', parentId: null, sort: 5, createdBy: 'u1', projectId: null },
]
const leaves: ExplorerLeaf[] = [
  {
    id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '생산계획-기획팀',
    fileCount: 0, createdBy: 'u1', createdByName: '홍길동', bodyPreview: '',
    meetingCategory: null, folderId: 'f-plan',
  },
]
const detail = (over: Partial<Minute> = {}): { minute: Minute; files: [] } => ({
  minute: {
    id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '생산계획-기획팀',
    bodyMd: '본문', meetingId: 'mt1', createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
    folderId: 'f-plan', ...over,
  },
  files: [],
})

describe('MinutesExplorer — 회의록 카드 메뉴', () => {
  let container: HTMLDivElement, root: Root
  const onChanged = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onChanged.mockClear(); toast.mockClear()
    fetchMinuteDetail.mockReset(); fetchMinuteDetail.mockResolvedValue(detail())
    deleteMinute.mockReset(); deleteMinute.mockResolvedValue({ ok: true })
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set()}
        onToggleFavorite={vi.fn()} onRetryFavorites={vi.fn()} layout="grid"
        currentUserId="u1" isFolderAdmin={false} onChanged={onChanged}
        projects={[{ id: 'p1', name: 'D-CUBE' }]} {...over} />,
    ))
  }
  const menuButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="min.exp.leafMenuAria"]')
  const menuItem = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(b => b.textContent?.includes(text))
  const modal = () => document.querySelector('[data-testid="meta-modal"]')
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

  it("'...' → [수정] 이 상세 페이지 이동 없이 메타 모달을 연다", async () => {
    await mount()
    expect(modal()).toBeNull()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.edit')!.click())
    expect(fetchMinuteDetail).toHaveBeenCalledWith('m1')
    expect(modal()).not.toBeNull()
    expect(document.querySelector('[data-testid="meta-title"]')?.textContent).toBe('생산계획-기획팀')
  })

  it('메뉴는 항목 클릭 후 닫힌다 — 모달 위로 잔상이 남지 않게', async () => {
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.edit')!.click())
    expect(container.querySelectorAll('[role="menuitem"]').length).toBe(0)
  })

  it('저장되면 onChanged 로 트리를 다시 읽고 모달을 닫는다', async () => {
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.edit')!.click())
    const saved = [...document.querySelectorAll('button')].find(b => b.textContent === '저장됨')!
    await act(async () => saved.click())
    expect(onChanged).toHaveBeenCalled()
    expect(modal()).toBeNull()
  })

  it('상세 조회가 null 이면 빈 모달을 열지 않고 실패를 알린다', async () => {
    // 빈 모달이 열리면 저장 시 meetingId·프로젝트 연결이 빈 값으로 덮인다.
    fetchMinuteDetail.mockResolvedValue(null)
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.edit')!.click())
    expect(modal()).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('상세 조회가 throw 해도 화면이 죽지 않고 실패를 알린다', async () => {
    fetchMinuteDetail.mockRejectedValue(new Error('조회 실패'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.edit')!.click())
    expect(modal()).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    spy.mockRestore()
  })

  it('리스트 레이아웃에서도 같은 메뉴가 있다', async () => {
    await mount({ layout: 'list' })
    expect(menuButton()).not.toBeNull()
  })

  it("'...' → [보관] 확인 후 회의록을 보관하고 탐색기를 갱신한다", async () => {
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.delete')!.click())

    expect(dialog()?.textContent).toContain('생산계획-기획팀')
    expect(dialog()?.textContent).toContain('min.detail.deleteConfirm')

    const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'min.detail.delete')!
    await act(async () => confirm.click())

    expect(deleteMinute).toHaveBeenCalledWith('m1')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    expect(toast).toHaveBeenCalledWith({ title: 'min.detail.deleteDone' })
  })

  it('보관 확인 창에서 취소하면 서버 액션을 호출하지 않는다', async () => {
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.delete')!.click())
    const cancel = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'common.cancel')!
    await act(async () => cancel.click())

    expect(deleteMinute).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('보관이 거부되면 확인 창을 유지하고 원인을 표시한다', async () => {
    deleteMinute.mockResolvedValue({ ok: false, error: '권한 없음' })
    await mount()
    await act(async () => menuButton()!.click())
    await act(async () => menuItem('min.detail.delete')!.click())
    const confirm = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'min.detail.delete')!
    await act(async () => confirm.click())

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('권한 없음')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
