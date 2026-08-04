// @vitest-environment jsdom
/**
 * 과거 버전 열람 화면(/minutes/<id>?version=<vid>)의 계약 가드.
 *
 * 버전 패널을 **기본 접힘**으로 바꾸면서 이 화면은 두 가지에 기대게 됐는데, 둘 다 아무
 * 테스트도 고정하고 있지 않았다:
 *   ① 위쪽 배너 — lib/data/minutes.ts 가 현재 버전의 viewHref 까지 `?version=` 로 만들기
 *      때문에 패널을 펼쳐 어떤 링크를 눌러도 과거 열람 화면에 머문다. 배너의
 *      `/minutes/<id>` 링크가 **라이브 화면으로 돌아가는 유일한 길**이다.
 *   ② 이 분기가 embedded 가 아닌 **접기 가능한** 패널을 렌더한다는 사실. 여기에 embedded 를
 *      넘기면 '항상 펼침' 구화면으로 조용히 되돌아간다 — 이번 변경이 없애려던 그 상태다.
 *
 * 그래서 패널을 mock 하지 않고 뷰어와 함께 실제로 렌더한다(형제 파일
 * minute-issue-draft-flow.test.tsx 는 패널을 null 로 죽여 이 결합을 볼 수 없다).
 */
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
  useLocale: () => ({ t: (key: string) => key, locale: 'ko' }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/issues', () => ({
  prepareMinuteIssueDraft: vi.fn(),
  fetchIssueProjectMembers: vi.fn(),
  createIssueFromMinuteBlock: vi.fn(),
  fetchIssueMajorProcesses: vi.fn().mockResolvedValue({ ok: true, majors: [] }),
}))
vi.mock('@/components/minutes/useMinuteTocSpy', () => ({
  useMinuteTocSpy: () => ({ activeToc: null, jumpTo: vi.fn() }),
}))
vi.mock('@/components/minutes/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteWikiImpactCard', () => ({ MinuteWikiImpactCard: () => null }))
vi.mock('@/components/minutes/MinuteFontSizeControl', () => ({ MinuteFontSizeControl: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))
vi.mock('@/components/minutes/MinuteSelectionBubble', () => ({ MinuteSelectionBubble: () => null }))
vi.mock('@/components/issues/IssueModals', () => ({ IssueFormModal: () => null }))

import { MinuteViewer } from '@/components/minutes/MinuteViewer'

const minute: Minute = {
  id: 'minute-1',
  minuteDate: '2026-07-31',
  teamCode: 'PMO',
  title: '현재 회의록 제목',
  bodyMd: '본문 한 문단.',
  meetingId: null,
  projectId: 'project-1',
  createdBy: 'user-1',
  createdByName: '작성자',
  createdAt: '2026-07-31T00:00:00Z',
  updatedAt: '2026-07-31T00:00:00Z',
}

// 실제 데이터 계층과 같은 모양 — 현재 버전도 viewHref 가 `?version=` 이다(lib/data/minutes.ts).
const versions = [
  { id: 'version-2', versionNo: 2, createdAt: '2026-08-03T04:05:00Z', createdByName: '장종익', viewHref: '/minutes/minute-1?version=version-2' },
  { id: 'version-1', versionNo: 1, createdAt: '2026-07-31T07:09:00Z', createdByName: '장종익', viewHref: '/minutes/minute-1?version=version-1' },
]

describe('과거 버전 열람 화면 — 배너와 접힘 패널', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount() {
    await act(async () => {
      root.render(
        <MinuteViewer
          minute={minute} files={[]} canManage={false}
          annotations={{ highlights: [], insights: [] }}
          userId="user-1" projects={[]} versions={versions}
          historicalVersion={{ id: 'version-1', versionNo: 1 }}
        />,
      )
    })
  }

  it('라이브 화면으로 돌아가는 링크가 남아 있다 — 패널 링크는 전부 ?version= 이라 이게 유일한 출구', async () => {
    await mount()
    expect(container.textContent).toContain('min.version.viewingBanner')
    const back = [...container.querySelectorAll('a')]
      .filter(a => a.getAttribute('href') === `/minutes/${minute.id}`)
    expect(back.length).toBeGreaterThan(0)
    expect(back.some(a => a.textContent?.includes('min.version.backCurrent'))).toBe(true)
  })

  it('버전 패널이 접기 가능한 형태로(기본 접힘) 렌더된다 — embedded 를 넘기면 실패한다', async () => {
    await mount()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
    // 접혀 있으므로 버전 목록이 본문을 밀어내지 않는다
    expect(container.querySelector('section[aria-labelledby="minute-version-title"] li')).toBeNull()
    // 접힘 상태에서도 어느 버전을 보는지 알 수 있다
    expect(container.textContent).toContain('min.version.viewing')
  })

  it('펼치면 두 버전이 모두 나오고 열람 중인 v1 이 표시된다', async () => {
    await mount()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    await act(async () => { toggle.click() })
    const items = [...container.querySelectorAll('section[aria-labelledby="minute-version-title"] li')]
    expect(items.length).toBe(2)
    const viewing = items.filter(li => li.textContent?.includes('min.version.viewing'))
    expect(viewing.length).toBe(1)
    expect(viewing[0].textContent).toContain('v1')
  })
})
