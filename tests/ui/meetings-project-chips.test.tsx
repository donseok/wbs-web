// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Meeting } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ fetchMyMeetings: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/app/actions/meetings', () => ({
  fetchMyMeetings: mocks.fetchMyMeetings,
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/minutes', () => ({
  fetchMeetingMinutesLite: vi.fn(async () => []),
}))
vi.mock('@/app/actions/announcements', () => ({
  createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })),
}))

import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', projectId: 'p1', title: '피원 회의', meetingDate: '2026-07-10',
    startTime: '10:00', endTime: '11:00', location: null, category: 'routine', body: '',
    recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
    isMine: true,
    ...overrides,
  }
}

describe('MyMeetingsView 프로젝트 필터 칩', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.fetchMyMeetings.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function mount(node: React.ReactElement) {
    await act(async () => {
      root.render(node)
      await Promise.resolve()
    })
  }

  function chipButtons() {
    return [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
  }

  it('프로젝트 2개 — 칩 행이 렌더되고 클릭 시 해당 프로젝트 회차만 남는다', async () => {
    const p1 = meeting({ id: 'm-p1', projectId: 'p1', projectName: '프로젝트 하나', title: '피원 회의' })
    const p2 = meeting({ id: 'm-p2', projectId: 'p2', projectName: '프로젝트 둘', title: '피투 회의', meetingDate: '2026-07-15' })
    await mount(
      <MyMeetingsView
        initialMeetings={[p1, p2]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null}
      />,
    )

    // 전체 + 프로젝트 2개 = 칩 3개, 초기엔 둘 다 보인다.
    expect(chipButtons()).toHaveLength(3)
    expect(container.textContent).toContain('피원 회의')
    expect(container.textContent).toContain('피투 회의')

    const p2Chip = chipButtons().find(b => b.textContent?.includes('프로젝트 둘'))
    expect(p2Chip).toBeTruthy()
    await act(async () => { p2Chip!.click() })

    expect(container.textContent).toContain('피투 회의')
    expect(container.textContent).not.toContain('피원 회의')

    const allChip = chipButtons().find(b => b.getAttribute('aria-pressed') === 'false' && b.textContent === 'meet.allProjects')
    expect(allChip).toBeTruthy()
    await act(async () => { allChip!.click() })

    expect(container.textContent).toContain('피원 회의')
    expect(container.textContent).toContain('피투 회의')
  })

  it('프로젝트 1개 — 칩 행을 렌더하지 않는다', async () => {
    const p1a = meeting({ id: 'm-p1a', projectId: 'p1', projectName: '프로젝트 하나', title: '피원 회의 1' })
    const p1b = meeting({ id: 'm-p1b', projectId: 'p1', projectName: '프로젝트 하나', title: '피원 회의 2', meetingDate: '2026-07-16' })
    await mount(
      <MyMeetingsView
        initialMeetings={[p1a, p1b]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null}
      />,
    )

    expect(chipButtons()).toHaveLength(0)
    expect(container.textContent).toContain('피원 회의 1')
    expect(container.textContent).toContain('피원 회의 2')
  })

  it('필터 선택 후 그 프로젝트가 없는 달로 이동하면 필터가 해제되어 전체가 다시 보인다(빈 화면 고착 없음)', async () => {
    const p1 = meeting({ id: 'm-p1', projectId: 'p1', projectName: '프로젝트 하나', title: '피원 회의' })
    const p2 = meeting({ id: 'm-p2', projectId: 'p2', projectName: '프로젝트 둘', title: '피투 회의', meetingDate: '2026-07-15' })
    await mount(
      <MyMeetingsView
        initialMeetings={[p1, p2]} initialExceptions={[]} todayIso="2026-07-19" currentUserId={null}
      />,
    )

    const p2Chip = chipButtons().find(b => b.textContent?.includes('프로젝트 둘'))
    await act(async () => { p2Chip!.click() })
    expect(container.textContent).toContain('피투 회의')
    expect(container.textContent).not.toContain('피원 회의')

    // 8월로 이동 — 서버가 돌려주는 새 달 데이터엔 p1 프로젝트만 있다(p2 없음).
    const augMeeting = meeting({ id: 'm-aug', projectId: 'p1', projectName: '프로젝트 하나', title: '8월 회의', meetingDate: '2026-08-10' })
    mocks.fetchMyMeetings.mockResolvedValue({ meetings: [augMeeting], exceptions: [] })

    const nextBtn = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.getAttribute('aria-label') === 'meet.nextMonth')
    expect(nextBtn).toBeTruthy()
    await act(async () => {
      nextBtn!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // 남은 프로젝트가 1개뿐이라 칩 행은 사라지고, 고아 필터에 가로막히지 않고 8월 회의가 보인다.
    expect(chipButtons()).toHaveLength(0)
    expect(container.textContent).toContain('8월 회의')
  })
})
