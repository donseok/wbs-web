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
const toast = vi.fn()
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

type BulkResult = {
  ok: boolean; error?: string; updated: number; unchanged: number
  skipped: { id: string; reason: string }[]
}
const assignMinutesProject = vi.fn<(ids: string[], p: string | null) => Promise<BulkResult>>()
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteToFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteFolder: vi.fn(async () => ({ ok: true })),
  fetchMinuteDetail: vi.fn(async () => null),
  assignMinutesProject: (ids: string[], p: string | null) => assignMinutesProject(ids, p),
}))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const folders: MinuteFolder[] = [{ id: 'f1', name: 'MES', parentId: null, sort: 0, createdBy: null }]
const leaf = (id: string, createdBy: string | null): ExplorerLeaf => ({
  id, minuteDate: '2026-07-24', teamCode: 'MES', title: `회의록 ${id}`, fileCount: 0,
  createdBy, createdByName: '홍길동', bodyPreview: '', meetingCategory: null, folderId: 'f1',
})
const leaves = [leaf('m1', 'u1'), leaf('m2', 'u1'), leaf('m3', 'other')]
const projects = [{ id: 'p1', name: 'D-CUBE 프로젝트' }]

describe('MinutesExplorer — 프로젝트 일괄 지정', () => {
  let container: HTMLDivElement, root: Root
  const onChanged = vi.fn()

  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    onChanged.mockClear(); toast.mockClear()
    assignMinutesProject.mockReset()
    assignMinutesProject.mockResolvedValue({ ok: true, updated: 2, unchanged: 0, skipped: [] })
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set()}
        onToggleFavorite={vi.fn()} onRetryFavorites={vi.fn()} layout="grid"
        currentUserId="u1" isAdmin={false} onChanged={onChanged} projects={projects} {...over} />,
    ))
  }
  const byText = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))
  const checkboxes = () => [...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')]
  const dialogButton = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(b => b.textContent?.includes(text))

  async function enterSelect() { await act(async () => byText('min.exp.select')!.click()) }

  it('평소에는 체크박스가 없다 — 읽는 화면이 고르는 화면이 되지 않게', async () => {
    await mount()
    expect(checkboxes().length).toBe(0)
    expect(byText('min.exp.select')).toBeTruthy()
  })

  it('선택 모드에서 편집 권한 있는 회의록에만 체크박스가 뜬다', async () => {
    await mount()
    await enterSelect()
    // m3 는 타인 작성(관리자 아님) — 서버가 어차피 거절하므로 고르게 두지 않는다
    expect(checkboxes().length).toBe(2)
  })

  it('관리자는 전부 고를 수 있다', async () => {
    await mount({ isAdmin: true })
    await enterSelect()
    expect(checkboxes().length).toBe(3)
  })

  it('선택 후 지정 — 선택한 id 만 서버로 간다', async () => {
    await mount()
    await enterSelect()
    await act(async () => checkboxes()[0].click())
    await act(async () => byText('min.exp.assignProject')!.click())
    await act(async () => dialogButton('D-CUBE 프로젝트')!.click())
    expect(assignMinutesProject).toHaveBeenCalledWith(['m1'], 'p1')
    expect(onChanged).toHaveBeenCalled()
  })

  it("'보이는 것 모두' 는 권한 있는 것만 담는다", async () => {
    await mount()
    await enterSelect()
    await act(async () => byText('min.exp.selectAll')!.click())
    await act(async () => byText('min.exp.assignProject')!.click())
    await act(async () => dialogButton('D-CUBE 프로젝트')!.click())
    expect(assignMinutesProject).toHaveBeenCalledWith(['m1', 'm2'], 'p1')
  })

  it("'연결 없음' 으로 해제도 된다", async () => {
    await mount()
    await enterSelect()
    await act(async () => checkboxes()[0].click())
    await act(async () => byText('min.exp.assignProject')!.click())
    await act(async () => dialogButton('min.exp.assignNone')!.click())
    expect(assignMinutesProject).toHaveBeenCalledWith(['m1'], null)
  })

  it('건너뛴 건이 있으면 건수를 알린다 — 전부 됐다로 읽히지 않게', async () => {
    assignMinutesProject.mockResolvedValue({
      ok: true, updated: 1, unchanged: 0, skipped: [{ id: 'm2', reason: '권한 없음' }],
    })
    await mount()
    await enterSelect()
    await act(async () => byText('min.exp.selectAll')!.click())
    await act(async () => byText('min.exp.assignProject')!.click())
    await act(async () => dialogButton('D-CUBE 프로젝트')!.click())
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('min.exp.assignPartial'),
    }))
  })

  it('서버가 실패를 돌려주면 선택을 유지하고 에러를 알린다 — 재시도할 수 있게', async () => {
    assignMinutesProject.mockResolvedValue({
      ok: false, error: '프로젝트를 찾을 수 없습니다.', updated: 0, unchanged: 0, skipped: [],
    })
    await mount()
    await enterSelect()
    await act(async () => checkboxes()[0].click())
    await act(async () => byText('min.exp.assignProject')!.click())
    await act(async () => dialogButton('D-CUBE 프로젝트')!.click())
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
    expect(onChanged).not.toHaveBeenCalled()
    expect(checkboxes().length).toBe(2)   // 선택 모드 유지
  })

  it('선택 모드에서는 카드 링크를 렌더하지 않는다 — 고르려다 상세로 튕기지 않게', async () => {
    await mount()
    expect(container.querySelectorAll('a[href="/minutes/m1"]').length).toBeGreaterThan(0)
    await enterSelect()
    expect(container.querySelectorAll('a[href="/minutes/m1"]').length).toBe(0)
  })

  it('프로젝트가 없으면 선택 도구 자체가 없다 — 지정할 대상이 없다', async () => {
    await mount({ projects: [] })
    expect(byText('min.exp.select')).toBeUndefined()
  })
})
