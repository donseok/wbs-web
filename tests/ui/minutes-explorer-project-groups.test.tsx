// @vitest-environment jsdom
// 탐색기 최상위 프로젝트 그룹(0076) — 그룹 헤더 렌더·접기 기본값·토글.
// 그룹핑 자체(groupExplorerByProject)의 순수 로직은 tests/minutes/explorer-project-groups.test.ts 가 검증한다.
// 여기서는 "화면에 어떻게 나타나는가"만 본다.
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

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const P2 = 'aaaaaaaa-0000-0000-0000-000000000002'

const folder = (id: string, name: string, projectId: string | null): MinuteFolder =>
  ({ id, name, parentId: null, sort: 0, createdBy: null, projectId })
const leaf = (id: string, title: string, folderId: string, projectId: string | null): ExplorerLeaf => ({
  id, minuteDate: '2026-08-12', teamCode: 'PMO', title, fileCount: 0, createdBy: 'u1',
  createdByName: '홍길동', bodyPreview: '', meetingCategory: null, folderId, projectId,
})

const folders = [
  folder('f-p1', 'P1 폴더', P1),
  folder('f-p2', 'P2 폴더', P2),
  folder('f-un', '전사 폴더', null),
]
const leaves = [
  leaf('m-p1', '프로젝트1 회의록', 'f-p1', P1),
  leaf('m-p2', '프로젝트2 회의록', 'f-p2', P2),
  leaf('m-un', '미지정 회의록', 'f-un', null),
]
const projects = [{ id: P1, name: '프로젝트1' }, { id: P2, name: '프로젝트2' }]

describe('MinutesExplorer — 프로젝트 그룹 헤더', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(over: Partial<Parameters<typeof MinutesExplorer>[0]> = {}) {
    await act(async () => root.render(
      <MinutesExplorer folders={folders} leaves={leaves} favorites={new Set()}
        onToggleFavorite={vi.fn()} onRetryFavorites={vi.fn()} layout="grid"
        currentUserId="u1" isFolderAdmin={false} onChanged={vi.fn()}
        projects={projects} myProjectIds={['p1-not-a-real-id']} {...over} />,
    ))
  }
  const groupHeader = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
      .find(b => b.textContent?.includes(label) && b.getAttribute('aria-label') === label)!

  it('내 프로젝트 그룹은 펼침, 그 외 프로젝트는 접힘 — 미지정은 항상 펼침', async () => {
    await mount({ myProjectIds: [P1] })
    // 내 프로젝트(P1) — 펼쳐져 폴더가 바로 보인다
    expect(groupHeader('프로젝트1').getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('P1 폴더')
    // 남의 프로젝트(P2) — 접혀서 폴더가 안 보인다
    expect(groupHeader('프로젝트2').getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-drop-target="f-p2"]')).toBeNull()
    // 미지정 — 소속 무관하게 펼침
    expect(groupHeader('min.grp.unassigned').getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('전사 폴더')
  })

  it('접힌 그룹 헤더를 클릭하면 펼쳐지고 하위 폴더가 드러난다', async () => {
    await mount({ myProjectIds: [P1] })
    expect(container.querySelector('[data-drop-target="f-p2"]')).toBeNull()
    await act(async () => groupHeader('프로젝트2').click())
    expect(container.querySelector('[data-drop-target="f-p2"]')).toBeTruthy()
    expect(groupHeader('프로젝트2').getAttribute('aria-expanded')).toBe('true')
  })

  it('내 프로젝트가 없으면(멤버 정보 없음) 모든 프로젝트 그룹이 접힌다 — 미지정만 펼침', async () => {
    await mount({ myProjectIds: null })
    expect(groupHeader('프로젝트1').getAttribute('aria-expanded')).toBe('false')
    expect(groupHeader('프로젝트2').getAttribute('aria-expanded')).toBe('false')
    expect(groupHeader('min.grp.unassigned').getAttribute('aria-expanded')).toBe('true')
  })

  it('각 그룹 헤더 옆에 그 그룹의 리프 총 건수가 표시된다', async () => {
    await mount({ myProjectIds: [P1] })
    expect(groupHeader('프로젝트1').textContent).toContain('1')
    expect(groupHeader('프로젝트2').textContent).toContain('1')
  })
})
