// @vitest-environment jsdom
// 프로젝트 회의일정 달력(MeetingsView)의 '내 것만 | 전체' 필터 — 사이드바 '내 회의' 탭과 같은 기준으로
// 달력·목록을 거른다. 기본은 '전체'(지금 화면 그대로), 선택은 이 브라우저에 기억한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Meeting } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/app/actions/meetings', () => ({
  createMeeting: vi.fn(async () => ({ ok: true })),
  updateMeeting: vi.fn(async () => ({ ok: true })),
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/meetingNotify', () => ({ notifyMeetingSaved: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/minutes', () => ({ fetchMeetingMinutesLite: vi.fn(async () => []) }))
vi.mock('@/app/actions/announcements', () => ({ createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })) }))

import { MeetingsView } from '@/components/meetings/MeetingsView'

const ME = 'user-me'
const MY_MEMBER = 'pm-me'
const STORAGE_KEY = 'dflow.meetings.onlyMine'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm', projectId: 'p1', title: '회의', meetingDate: '2026-07-10',
    startTime: '10:00', endTime: '11:00', location: null, category: 'routine', body: '',
    recurrence: 'none', recurrenceUntil: null, createdBy: 'user-other', createdByName: '남',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
    ...overrides,
  }
}

// 7월 그리드 안의 세 회의: 내가 만든 것 · 내가 참석자인 것 · 남의 것.
const MADE_BY_ME = meeting({ id: 'm-made', title: '내가 만든 회의', createdBy: ME })
const ATTENDING = meeting({ id: 'm-att', title: '참석하는 회의', meetingDate: '2026-07-14', attendeeIds: ['pm-x', MY_MEMBER] })
const OTHERS = meeting({ id: 'm-other', title: '남의 회의', meetingDate: '2026-07-21', attendeeIds: ['pm-x'] })

describe('MeetingsView — 내 것만 필터', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(meetings: Meeting[] = [MADE_BY_ME, ATTENDING, OTHERS], myMemberIds: string[] = [MY_MEMBER]) {
    await act(async () => {
      root.render(
        <MeetingsView
          projectId="p1" meetings={meetings} exceptions={[]} members={[]} todayIso="2026-07-19"
          currentUserId={ME} role="member" myMemberIds={myMemberIds}
        />,
      )
      await Promise.resolve()
    })
  }

  function tab(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(b => b.textContent?.trim() === label)
    if (!found) throw new Error(`tab '${label}' not found; tabs=${[...container.querySelectorAll('button[role="tab"]')].map(b => b.textContent).join(',')}`)
    return found
  }
  async function click(el: HTMLElement) {
    await act(async () => { el.click(); await Promise.resolve() })
  }
  const rowTitles = () => [...container.querySelectorAll('tbody tr td:nth-child(3)')].map(td => td.textContent)

  it('기본은 전체 — 세 회의가 모두 목록에 보인다', async () => {
    await mount()
    await click(tab('meet.view.list'))
    expect(tab('meet.allMeetings').getAttribute('aria-selected')).toBe('true')
    expect(rowTitles()).toEqual(['내가 만든 회의', '참석하는 회의', '남의 회의'])
  })

  it("'내 것만'을 누르면 내가 만든 회의와 참석하는 회의만 남고 남의 회의는 빠진다", async () => {
    await mount()
    await click(tab('meet.view.list'))
    await click(tab('meet.onlyMine'))
    expect(rowTitles()).toEqual(['내가 만든 회의', '참석하는 회의'])
  })

  it("'내 것만'인데 해당 회의가 없으면 '내 회의 없음' 빈 화면을 보여 준다", async () => {
    await mount([OTHERS])
    await click(tab('meet.view.list'))
    await click(tab('meet.onlyMine'))
    expect(container.textContent).toContain('meet.empty.mineTitle')
    expect(container.textContent).not.toContain('남의 회의')
  })

  it('달력 보기도 필터를 따른다 — 남의 회의 제목이 달력에서 사라진다', async () => {
    await mount()
    expect(container.textContent).toContain('남의 회의')
    await click(tab('meet.onlyMine'))
    expect(container.textContent).not.toContain('남의 회의')
    expect(container.textContent).toContain('참석하는 회의')
  })

  it('선택을 이 브라우저에 기억한다 — 저장된 값이 있으면 그대로 시작하고, 바꾸면 저장한다', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    await mount()
    await click(tab('meet.view.list'))
    expect(tab('meet.onlyMine').getAttribute('aria-selected')).toBe('true')
    expect(rowTitles()).toEqual(['내가 만든 회의', '참석하는 회의'])
    await click(tab('meet.allMeetings'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
  })
})
