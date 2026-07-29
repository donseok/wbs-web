// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MarkdownView', () => ({ MarkdownView: () => null }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const base: Minute = {
  id: 'm1', minuteDate: '2026-07-24', teamCode: 'MES', title: '생산계획-기획팀_2026.07.24',
  bodyMd: '본문', meetingId: null, createdBy: 'u1', createdByName: '작성자',
  createdAt: '2026-07-24T00:00:00Z', updatedAt: '2026-07-24T00:00:00Z',
}

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

describe('MinuteViewer 편철 경로 breadcrumb', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IntersectionObserver = IntersectionObserverStub
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(minute: Minute, folderPath: string[] | null) {
    act(() => {
      root.render(
        <MinuteViewer minute={minute} files={[]} canManage={false}
          annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]}
          folderPath={folderPath} />,
      )
    })
    return container.querySelector('nav[aria-label="min.detail.pathAria"]')
  }

  it('경로 세그먼트를 root-first 순서로 보여준다 — 팀 배지와 겹치는 루트는 접는다', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀', '2026'])
    expect(nav).not.toBeNull()
    // 구분자(chevron)는 svg 라 텍스트에 섞이지 않는다 — 세그먼트만 순서대로 남는다
    expect(nav?.textContent).toBe('기획팀2026')
  })

  it('루트가 팀 코드와 다르면 접지 않는다 — 시드 체인 밖 폴더의 위치를 숨기지 않는다', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['보관', '2025'])
    expect(nav?.textContent).toBe('보관2025')
  })

  it('팀 루트에 바로 꽂힌 회의록(경로 1칸)은 접지 않는다 — 접으면 남는 게 없다', () => {
    const nav = render({ ...base, folderId: 'f1' }, ['MES'])
    expect(nav?.textContent).toBe('MES')
  })

  it('미분류(folderId 없음)는 미분류 문구', () => {
    const nav = render({ ...base, folderId: null }, null)
    expect(nav?.textContent).toBe('min.fold.unfiled')
  })

  it('folderId 는 있는데 경로 해석이 실패하면 미분류로 위장하지 않는다', () => {
    // 폴더 스냅샷 조회 실패·끊긴 체인 — 둘 다 서버에서 null 로 온다. '미분류'로 보이면
    // 사용자는 편철이 풀린 줄 알고 다시 옮긴다.
    const nav = render({ ...base, folderId: 'f3' }, null)
    expect(nav?.textContent).toBe('min.detail.pathUnknown')
  })

  it('마지막 세그먼트만 강조 — 현재 위치가 어디인지 한눈에', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['보관', '기획팀'])
    const segs = [...(nav?.querySelectorAll('span.truncate') ?? [])]
    expect(segs.map(s => s.textContent)).toEqual(['보관', '기획팀'])
    expect(segs[0]?.className).not.toContain('font-semibold')
    expect(segs[1]?.className).toContain('font-semibold')
    // 조상부터 줄이고 현재 위치는 지킨다
    expect(segs[1]?.className).toContain('shrink-0')
  })

  it('breadcrumb 은 메타 행 안에 있다 — 헤더가 두 줄로 커지지 않게', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀'])
    // nav 의 부모는 팀 배지와 경로를 묶는 위치 칩, 그 부모가 메타 행
    const row = nav?.parentElement?.parentElement
    // 같은 행에 제목(h1)과 뒤로가기 링크가 함께 있어야 한 줄이다
    expect(row?.querySelector('h1')?.textContent).toBe(base.title)
    expect(row?.querySelector('a[href="/minutes"]')).not.toBeNull()
  })

  it('팀 배지와 경로가 테두리 있는 한 칩으로 묶인다 — 잔글씨로 메타에 묻히지 않게', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀'])
    const chip = nav?.parentElement
    expect(chip?.className).toContain('border')
    expect(chip?.className).toContain('rounded-full')
    // 팀 배지가 칩 안에서 경로 앞에 온다
    expect(chip?.firstElementChild?.textContent).toBe('MES')
    // 칩은 메타 행의 첫 요소인 '목록으로' 링크 바로 뒤 — 행 맨 앞에서 먼저 읽힌다
    const row = chip?.parentElement
    expect(row?.children[0]?.tagName).toBe('A')
    expect(row?.children[1]).toBe(chip)
  })

  it('편철이 없거나 경로를 못 읽으면 칩 테두리가 점선 — 실선(확정된 위치)과 구분된다', () => {
    const unfiled = render({ ...base, folderId: null }, null)
    expect(unfiled?.parentElement?.className).toContain('border-dashed')
    const located = render({ ...base, folderId: 'f3' }, ['MES', '기획팀'])
    expect(located?.parentElement?.className).not.toContain('border-dashed')
  })

  it('잘린 경로는 title 로 전체를 보여준다 — 접은 팀 루트까지 포함', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀', '2026'])
    expect(nav?.getAttribute('title')).toBe('MES / 기획팀 / 2026')
  })
})
