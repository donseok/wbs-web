import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
// 이 테스트의 관심사는 회의 링크 매핑이다 — 비공개 프로젝트 숨김(0070)은 항목 필터 테스트
// (private-project-hidden.test.ts)가 따로 검증하므로 여기서는 '숨김 없음'으로 고정한다.
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: vi.fn(async () => new Set()) }))

import { getMinutesExplorer } from '@/lib/data/minutes'

/** 탐색기 조회는 minutes·minute_folders 두 쿼리를 Promise.all 로 던진다 — from() 을 테이블별로 갈라준다. */
function client(minuteRows: Record<string, unknown>[]) {
  const minutes = {
    select: vi.fn(), is: vi.fn(), order: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: minuteRows, error: null }),
  }
  minutes.select.mockReturnValue(minutes)
  minutes.is.mockReturnValue(minutes)
  minutes.order.mockReturnValue(minutes)

  const folders = { select: vi.fn(), order: vi.fn() }
  folders.select.mockReturnValue(folders)
  folders.order.mockReturnValueOnce(folders).mockReturnValueOnce({ data: [], error: null })

  return { from: vi.fn((t: string) => (t === 'minutes' ? minutes : folders)) }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1', minute_date: '2026-07-24', team_code: 'MES', title: 'APS 인터뷰',
  meeting_id: 'mt1', project_id: null, meeting_occurrence_date: '2026-07-24',
  archived_at: null, created_by: 'u1', created_by_name: '홍길동',
  created_at: '2026-07-24T00:00:00Z', updated_at: '2026-07-24T00:00:00Z',
  body_preview: '', folder_id: 'f-plan', minute_files: [{ count: 0 }],
  meetings: { category: 'routine', project_id: 'p1' }, projects: null,
  ...over,
})

describe('getMinutesExplorer — 연결된 회의', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('리프에 meetingId·meetingProjectId 를 실어 보낸다 — 탐색기가 회의 링크를 걸 수 있게', async () => {
    mocks.createServerClient.mockResolvedValue(client([row()]))
    const res = await getMinutesExplorer()
    expect(res?.leaves[0].meetingId).toBe('mt1')
    expect(res?.leaves[0].meetingProjectId).toBe('p1')
  })

  it('회의 조인이 비면 meetingProjectId 는 null — 회의록 자신의 프로젝트로 대체하지 않는다', async () => {
    // meeting_id 는 남아 있는데 meetings 를 못 읽는 상황(권한·끊긴 참조). 회의록의 project_id 로
    // 링크를 만들면 엉뚱한 프로젝트의 회의 달력으로 보내게 된다 — 링크를 걸지 않는 쪽이 맞다.
    mocks.createServerClient.mockResolvedValue(client([row({ meetings: null, project_id: 'p2' })]))
    const res = await getMinutesExplorer()
    expect(res?.leaves[0].meetingId).toBe('mt1')
    expect(res?.leaves[0].meetingProjectId).toBeNull()
  })

  it('회의 미연결 회의록은 둘 다 null', async () => {
    mocks.createServerClient.mockResolvedValue(client([row({ meeting_id: null, meetings: null })]))
    const res = await getMinutesExplorer()
    expect(res?.leaves[0].meetingId).toBeNull()
    expect(res?.leaves[0].meetingProjectId).toBeNull()
  })
})
