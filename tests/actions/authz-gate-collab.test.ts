import { describe, it, expect, vi, beforeEach } from 'vitest'

// 가드 자체의 판정(누가 admin/member 인가)은 tests/authz/guards.test.ts 가 본다.
// 이 파일은 협업 액션 쪽 배선만 본다 — 어떤 액션이 어떤 가드를 부르고, 거부되면 DB 에 손대지 않는가.
const { requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
// 게이트를 통과하기 전에 DB 클라이언트를 만들면 그 자리에서 실패한다(issues-gate 관례).
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => { throw new Error('게이트 통과 전 createServerClient 호출 금지') }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, requireSuperuser, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { createWeeklyReport, saveWeeklyCell, saveWeeklyCells, saveWeeklyTitle } from '@/app/actions/weekly'
import { removeAttendance, upsertAttendance } from '@/app/actions/attendance'
import { createMeeting } from '@/app/actions/meetings'

const DENIED = { ok: false, error: '권한 없음' } as const
const MEMBER = {
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map([['p1', 'member' as const]]),
}
const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'

const MEETING_INPUT = {
  title: '주간 점검', meetingDate: '2026-07-27', startTime: '14:00', endTime: '15:00',
  location: null, category: 'routine' as const, body: '', recurrence: 'none' as const,
  recurrenceUntil: null, attendeeIds: [] as string[],
}

beforeEach(() => {
  createServerClient.mockClear()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
})

describe('주간업무 시트 — 개편 전에는 로그인만으로 쓸 수 있었다(회귀 방어)', () => {
  it('saveWeeklyCell: 프로젝트 역할이 없으면 거부하고 DB 에 접근하지 않는다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await saveWeeklyCell('p1', 'r1', 'this_content', '내용')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('p1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('saveWeeklyCells: 배치 경로도 같은 멤버 가드를 지난다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await saveWeeklyCells('p1', [{ rowId: 'r1', cellKey: 'this_content', content: '내용' }])
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('p1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 편집이 하나도 없어도 게이트가 먼저다 — no-op 이 인증 우회 통로가 되지 않게.
  it('saveWeeklyCells: 빈 배치도 게이트를 먼저 지난다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await saveWeeklyCells('p1', [])
    expect(res).toEqual({ ok: false, error: '권한 없음' })
  })

  it('saveWeeklyTitle: 제목 저장도 멤버 가드를 지난다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await saveWeeklyTitle('p1', 'rep1', '제목')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('createWeeklyReport: 회차 생성은 멤버 가드가 아니라 관리자 가드다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await createWeeklyReport('p1', '2026-07-27', false)
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectAdmin).toHaveBeenCalledWith('p1')
    expect(requireProjectMember).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('근태 — 프로젝트 멤버 가드', () => {
  it('upsertAttendance: 프로젝트 역할이 없으면 거부하고 DB 에 접근하지 않는다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await upsertAttendance('p1', { memberId: 'pm1', date: '2026-07-27', type: 'annual' })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('p1')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 삭제는 인자에 projectId 가 없다 — 기록의 프로젝트를 못 읽으면 판정 자체가 불가능하므로 중단한다.
  it('removeAttendance: 대상 기록의 프로젝트 조회가 실패하면 권한 판정 없이 중단한다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: ERR_LOOKUP })
    const res = await removeAttendance('rec1')
    expect(res).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(resolveProjectId).toHaveBeenCalledWith('attendance_records', 'rec1')
    expect(requireProjectMember).not.toHaveBeenCalled()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('removeAttendance: 프로젝트를 확정한 뒤 그 프로젝트 기준으로 멤버 가드를 본다', async () => {
    resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p9' })
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await removeAttendance('rec1')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('p9')
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('회의 — 프로젝트 멤버 가드', () => {
  it('createMeeting: 프로젝트 역할이 없으면 입력 검증·DB 도달 전에 거부한다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await createMeeting('p1', { ...MEETING_INPUT })
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(requireProjectMember).toHaveBeenCalledWith('p1')
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('대상 결합 회귀 — 인자 projectId 만으로는 남의 행을 쓸 수 없다', () => {
  it('upsertAttendance: 대상 멤버가 이 프로젝트 로스터가 아니면 거부', async () => {
    requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
    // project_members 대조가 0행 → 거부, attendance_records 로는 가지 않는다
    const touched: string[] = []
    createServerClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        touched.push(table)
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'maybeSingle', 'upsert']) b[m] = vi.fn(() => b)
        ;(b as { then: (r: (v: unknown) => void) => void }).then =
          resolve => resolve({ data: null, error: null })
        return b
      }),
    } as never)
    const res = await upsertAttendance('p1', { memberId: 'm-other', date: '2026-07-30', type: 'work' } as never)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('멤버')
    expect(touched).not.toContain('attendance_records')
  })

  it('upsertAttendance: 로스터 확인 조회가 실패하면 중단한다 — fail-closed', async () => {
    requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
    createServerClient.mockResolvedValue({
      from: vi.fn(() => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'maybeSingle', 'upsert']) b[m] = vi.fn(() => b)
        ;(b as { then: (r: (v: unknown) => void) => void }).then =
          resolve => resolve({ data: null, error: { message: 'db down' } })
        return b
      }),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await upsertAttendance('p1', { memberId: 'm1', date: '2026-07-30', type: 'work' } as never)
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('확인할 수 없어')
  })

  it('saveWeeklyCell: 대상 행이 이 프로젝트 회차 소속이 아니면 쓰지 않는다', async () => {
    requireProjectMember.mockResolvedValue({ ok: true, actor: MEMBER })
    const methods: string[] = []
    createServerClient.mockResolvedValue({
      from: vi.fn(() => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'update']) {
          b[m] = vi.fn(() => { methods.push(m); return b })
        }
        ;(b as { then: (r: (v: unknown) => void) => void }).then =
          resolve => resolve({ data: [], error: null })   // 소속 0행
        return b
      }),
    } as never)
    const res = await saveWeeklyCell('p1', 'row-other', 'this_content', 'x')
    expect(res.ok).toBe(false)
    expect(methods).not.toContain('update')
  })
})
