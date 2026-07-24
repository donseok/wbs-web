// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  Announcement,
  AttendanceRecord,
  ComputedItem,
  Meeting,
  ProjectMember,
} from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 각 시나리오가 마운트 전에 currentSearch 만 바꿔 딥링크 쿼리를 주입한다.
let currentSearch = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/p/p1/menu',
  useSearchParams: () => new URLSearchParams(currentSearch),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
// MeetingsView 가 항상 마운트하는 MeetingFormModal 이 useToast 를 쓴다.
// 이 테스트는 뷰만 단독 마운트해 ToastProvider 가 없으므로 훅 자체를 대체한다.
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/meetings', () => ({
  fetchMyMeetings: vi.fn(async () => ({ meetings: [], exceptions: [] })),
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/minutes', () => ({
  fetchMeetingMinutesLite: vi.fn(async () => []),
}))
vi.mock('@/app/actions/announcements', () => ({
  createAnnouncement: vi.fn(async () => ({ ok: true })),
  updateAnnouncement: vi.fn(async () => ({ ok: true })),
  deleteAnnouncement: vi.fn(async () => ({ ok: true })),
  createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })),
  markAnnouncementsSeen: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/attendance', () => ({
  upsertAttendance: vi.fn(async () => ({ ok: true })),
  removeAttendance: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/members', () => ({
  addMember: vi.fn(async () => ({ ok: true })),
  updateMember: vi.fn(async () => ({ ok: true })),
  removeMember: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/wbs', () => ({
  updateActual: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true })),
  updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({ ok: true })),
}))

import { MeetingsView } from '@/components/meetings/MeetingsView'
import { MyMeetingsView } from '@/components/meetings/MyMeetingsView'
import { AttendanceView } from '@/components/attendance/AttendanceView'
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView'
import { MembersBoard } from '@/components/members/MembersBoard'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { IssuesView } from '@/components/issues/IssuesView'
import type { Issue } from '@/lib/domain/issues'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', projectId: 'p1', title: '주간 정기회의', meetingDate: '2026-09-15',
    startTime: '10:00', endTime: '11:00', location: 'A회의실', category: 'routine', body: '',
    recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
    ...overrides,
  }
}

function member(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 'mem-1', projectId: 'p1', name: '김이알피', email: null, teamCode: 'ERP',
    role: 'contributor', title: null, hasAccount: true, createdAt: '2026-01-01',
    ...overrides,
  }
}

function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'a1', projectId: 'p1', memberId: 'mem-1', date: '2026-06-10', type: 'annual', note: null,
    ...overrides,
  }
}

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'ann-1', projectId: 'p1', title: '일반 공지', body: '내용', category: 'general',
    isPinned: false, publishFrom: null, publishTo: null,
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function issueFx(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'iss-1', issueNo: 1, projectId: 'p1', title: '기준정보 오류', body: '',
    status: 'open', severity: 'medium', assigneeMemberIds: [], dueDate: null,
    resolutionNote: '', resolvedAt: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00+00:00', updatedAt: '2026-07-01T00:00:00+00:00', ...overrides,
  }
}

function kanbanLeaf(overrides: Partial<ComputedItem> = {}): ComputedItem {
  return {
    id: 'leaf-1', parentId: 'phase-1', level: 'task', code: '1.1', sortOrder: 1, name: '작업',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-31',
    weight: null, actualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }],
    plannedPct: 50, rolledActualPct: 50, achievement: 1, status: 'in_progress', children: [],
    ...overrides,
  }
}

describe('메뉴별 딥링크 query parameter 소비', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    currentSearch = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove())
  })

  async function mount(node: React.ReactElement) {
    await act(async () => {
      root.render(node)
      await Promise.resolve()
    })
  }

  function dialog(): HTMLElement | null {
    return document.querySelector('[role="dialog"]')
  }

  it('MeetingsView: ?focus=&date= 로 해당 회차 상세를 열고 그 달로 이동한다', async () => {
    currentSearch = 'focus=m1&date=2026-09-15'
    await mount(
      <MeetingsView projectId="p1" meetings={[meeting()]} exceptions={[]} members={[]}
        todayIso="2026-07-19" currentUserId={null} role={null} />,
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('주간 정기회의')
    expect(container.textContent).toContain('2026. 9.')
  })

  it('MeetingsView: 존재하지 않는 회의 focus 는 조용히 무시한다', async () => {
    currentSearch = 'focus=ghost&date=2026-09-15'
    await mount(
      <MeetingsView projectId="p1" meetings={[meeting()]} exceptions={[]} members={[]}
        todayIso="2026-07-19" currentUserId={null} role={null} />,
    )
    expect(dialog()).toBeNull()
    expect(container.textContent).toContain('2026. 7.')
  })

  it('MyMeetingsView: /meetings?focus= 로 초기 데이터에서 상세를 연다', async () => {
    currentSearch = 'focus=m1'
    await mount(
      <MyMeetingsView
        initialMeetings={[meeting({ meetingDate: '2026-07-21', projectName: '프로젝트 1', isMine: true })]}
        initialExceptions={[]} todayIso="2026-07-19" currentUserId={null} role={null} />,
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('주간 정기회의')
  })

  it('AttendanceView: ?from&to&team&type 초기 필터를 적용하고 해제할 수 있다', async () => {
    currentSearch = 'from=2026-06-01&to=2026-06-30&team=ERP&type=annual'
    const members = [
      member({ id: 'mem-erp', name: '김이알피', teamCode: 'ERP' }),
      member({ id: 'mem-pmo', name: '박피엠오', teamCode: 'PMO' }),
    ]
    const records = [
      attendance({ id: 'a1', memberId: 'mem-erp', date: '2026-06-10', type: 'annual' }),
      attendance({ id: 'a2', memberId: 'mem-pmo', date: '2026-06-11', type: 'trip' }),
      attendance({ id: 'a3', memberId: 'mem-erp', date: '2026-07-02', type: 'annual' }),
    ]
    await mount(
      <AttendanceView projectId="p1" records={records} members={members}
        initialDate="2026-07-19" canEdit={false} />,
    )
    // from 의 달(6월)로 이동 + ERP·annual·기간 내 기록 칩만 남는다(멤버 셀렉트 옵션은 제외하고 판정).
    expect(container.textContent).toContain('2026. 6.')
    expect(container.querySelector('[title*="김이알피"]')).not.toBeNull()
    expect(container.querySelector('[title*="박피엠오"]')).toBeNull()

    const clear = [...container.querySelectorAll('button')].find(b => b.textContent === '해제')
    expect(clear).toBeTruthy()
    await act(async () => clear!.click())
    expect(container.querySelector('[title*="박피엠오"]')).not.toBeNull()
  })

  it('AttendanceView: 무효 파라미터는 조용히 무시한다', async () => {
    currentSearch = 'from=bad&to=2026-06-30&team=QA&type=nope'
    await mount(
      <AttendanceView projectId="p1" records={[attendance()]} members={[member()]}
        initialDate="2026-07-19" canEdit={false} />,
    )
    expect(container.textContent).toContain('2026. 7.')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === '해제')).toBe(false)
  })

  it('AnnouncementsView: ?focus= 로 해당 공지 상세를 연다', async () => {
    currentSearch = 'focus=ann-2'
    await mount(
      <AnnouncementsView projectId="p1" lastSeenAt={null} canEdit={false}
        announcements={[announcement(), announcement({ id: 'ann-2', title: '중요 공지' })]} />,
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('중요 공지')
  })

  it('AnnouncementsView: 비관리자는 게시 스코프 밖 공지 focus 를 무시한다', async () => {
    currentSearch = 'focus=ann-3'
    await mount(
      <AnnouncementsView projectId="p1" lastSeenAt={null} canEdit={false}
        announcements={[
          announcement(),
          announcement({ id: 'ann-3', title: '예정 공지', publishFrom: '2099-01-01', publishTo: '2099-12-31' }),
        ]} />,
    )
    expect(dialog()).toBeNull()
  })

  it('MembersBoard: ?team= 초기 팀 필터를 적용한다', async () => {
    currentSearch = 'team=MES'
    await mount(
      <MembersBoard projectId="p1" canEdit={false} members={[
        member({ id: 'mem-erp', name: '김이알피', teamCode: 'ERP' }),
        member({ id: 'mem-mes', name: '최엠이에스', teamCode: 'MES' }),
      ]} />,
    )
    expect(container.textContent).toContain('최엠이에스')
    expect(container.textContent).not.toContain('김이알피')
  })

  it('MembersBoard: 무효 팀 값은 전체 표시를 유지한다', async () => {
    currentSearch = 'team=QA'
    await mount(
      <MembersBoard projectId="p1" canEdit={false} members={[
        member({ id: 'mem-erp', name: '김이알피', teamCode: 'ERP' }),
        member({ id: 'mem-mes', name: '최엠이에스', teamCode: 'MES' }),
      ]} />,
    )
    expect(container.textContent).toContain('김이알피')
    expect(container.textContent).toContain('최엠이에스')
  })

  it('KanbanBoard: ?view=&team= 으로 초기 모드와 검색 필터를 적용한다', async () => {
    currentSearch = 'view=owner&team=ERP'
    const items: ComputedItem[] = [
      kanbanLeaf({
        id: 'phase-1', parentId: null, level: 'phase', code: '1', name: '구축', owners: [],
        children: [
          kanbanLeaf({ id: 'leaf-1', name: 'ERP 인터페이스' }),
          kanbanLeaf({ id: 'leaf-2', name: '설비 점검', owners: [{ team: 'MES', kind: 'primary' }] }),
        ],
      }),
    ]
    await mount(
      <KanbanBoard projectId="p1" items={items} membership={null} today="2026-07-19" />,
    )
    // owner 모드 컬럼(PMO 헤더)과 team 검색어 프리필 + ERP 카드만 남는다.
    expect(container.textContent).toContain('PMO')
    const search = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
    expect(search?.value).toBe('ERP')
    expect(container.textContent).toContain('ERP 인터페이스')
    expect(container.textContent).not.toContain('설비 점검')
  })

  it('KanbanBoard: 무효 view 는 기본 phase 모드를 유지한다', async () => {
    currentSearch = 'view=matrix'
    await mount(
      <KanbanBoard projectId="p1" items={[
        kanbanLeaf({
          id: 'phase-1', parentId: null, level: 'phase', code: '1', name: '구축', owners: [],
          children: [kanbanLeaf({ id: 'leaf-1', name: 'ERP 인터페이스' })],
        }),
      ]} membership={null} today="2026-07-19" />,
    )
    // phase 모드면 컬럼 제목이 루트 이름(구축)이다.
    expect(container.textContent).toContain('구축')
    expect(container.textContent).not.toContain('미배정')
  })

  it('IssuesView: ?focus= 로 해당 이슈 상세를 연다', async () => {
    currentSearch = 'focus=iss-2'
    await mount(
      <IssuesView projectId="p1" currentUserId={null} role={null} myMemberIds={[]} today="2026-07-23"
        members={[]} issues={[issueFx(), issueFx({ id: 'iss-2', title: '인터페이스 오류' })]} />,
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('인터페이스 오류')
  })

  it('IssuesView: 무효 focus id 는 조용히 무시한다', async () => {
    currentSearch = 'focus=iss-없음'
    await mount(
      <IssuesView projectId="p1" currentUserId={null} role={null} myMemberIds={[]} today="2026-07-23"
        members={[]} issues={[issueFx()]} />,
    )
    expect(dialog()).toBeNull()
  })
})
