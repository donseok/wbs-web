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
vi.mock('@/app/actions/minutes', () => ({
  createMinuteFolder: vi.fn(async () => ({ ok: true })),
  renameMinuteFolder: vi.fn(async () => ({ ok: true })),
  deleteMinuteFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteToFolder: vi.fn(async () => ({ ok: true })),
  moveMinuteFolder: vi.fn(async () => ({ ok: true })),
  fetchMinuteDetail: vi.fn(async () => null),
}))

import { MinutesExplorer } from '@/components/minutes/MinutesExplorer'

const folders: MinuteFolder[] = [
  { id: 'f-plan', name: '생산계획', parentId: null, sort: 5, createdBy: 'u1' },
]
const leaf = (over: Partial<ExplorerLeaf> = {}): ExplorerLeaf => ({
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: 'APS 인터뷰',
  fileCount: 0, createdBy: 'u1', createdByName: '홍길동', bodyPreview: '',
  meetingCategory: 'routine', folderId: 'f-plan',
  meetingId: 'mt1', meetingProjectId: 'p1', ...over,
})

/** 상세 뷰어에만 있던 '연결된 회의'를 탐색기 카드·행에서도 확인할 수 있어야 한다.
 *  대상은 상세와 동일 — 그 회의가 속한 프로젝트의 회의 달력. */
describe('MinutesExplorer — 연결된 회의 칩', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={[leaf()]} favorites={new Set()}
        onToggleFavorite={vi.fn()} onRetryFavorites={vi.fn()} layout="grid"
        currentUserId="u1" isFolderAdmin={false} onChanged={vi.fn()} {...over} />,
    ))
  }
  const meetingLink = () => container.querySelector<HTMLAnchorElement>('a[href="/p/p1/meetings"]')

  it('그리드 카드에 회의 달력 링크가 상세와 같은 문구로 붙는다', async () => {
    await mount()
    expect(meetingLink()).not.toBeNull()
    expect(meetingLink()?.textContent).toContain('min.detail.linkedMeeting')
  })

  it('리스트 행에도 같은 링크가 붙는다', async () => {
    await mount({ layout: 'list' })
    expect(meetingLink()).not.toBeNull()
  })

  it('링크는 draggable=false — 카드 드래그가 링크 끌기로 바뀌지 않게', async () => {
    // 앵커는 기본 draggable 이라, 두면 폴더 이동 드래그 대신 URL 이 끌린다(전면 오버레이와 같은 이유)
    await mount()
    expect(meetingLink()?.getAttribute('draggable')).toBe('false')
  })

  it('회의의 프로젝트를 모르면 링크를 만들지 않는다 — 엉뚱한 프로젝트로 보내지 않게', async () => {
    await mount({ leaves: [leaf({ meetingProjectId: null })] })
    expect(container.querySelector('a[href^="/p/"]')).toBeNull()
    expect(container.textContent).not.toContain('min.detail.linkedMeeting')
  })

  it('회의 미연결 회의록에는 칩이 없다', async () => {
    await mount({ leaves: [leaf({ meetingId: null, meetingProjectId: null, meetingCategory: null })] })
    expect(container.textContent).not.toContain('min.detail.linkedMeeting')
  })

  it('카드 전면 링크는 그대로 회의록 상세로 간다 — 회의 링크가 덮어쓰지 않는다', async () => {
    await mount()
    expect(container.querySelector('a[href="/minutes/m1"]')).not.toBeNull()
  })
})
