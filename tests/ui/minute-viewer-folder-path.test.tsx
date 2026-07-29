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

  it('경로 세그먼트를 root-first 순서로 전부 보여준다', () => {
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀', '2026'])
    expect(nav).not.toBeNull()
    // 구분자(chevron)는 svg 라 텍스트에 섞이지 않는다 — 세그먼트만 순서대로 남는다
    expect(nav?.textContent).toBe('MES기획팀2026')
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
    const nav = render({ ...base, folderId: 'f3' }, ['MES', '기획팀'])
    const segs = [...(nav?.querySelectorAll('span.truncate') ?? [])]
    expect(segs.map(s => s.textContent)).toEqual(['MES', '기획팀'])
    expect(segs[0]?.className).not.toContain('font-medium')
    expect(segs[1]?.className).toContain('font-medium')
  })
})
