import { describe, expect, it, vi } from 'vitest'
import { createSupabaseAttendanceRepository } from '@/lib/repositories/supabase/attendance'
import { createSupabaseMeetingRepository } from '@/lib/repositories/supabase/meetings'
import { createSupabaseWbsRepository } from '@/lib/repositories/supabase/wbs'
import { createSupabaseWeeklyRepository } from '@/lib/repositories/supabase/weekly'

type QueryResponse = { data: unknown; error: unknown }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

describe('strict Supabase repositories', () => {
  it('weekly: missing report is a successful null and performs SELECT only', async () => {
    const report = queryBuilder({ data: null, error: null })
    const from = vi.fn((table: string) => {
      if (table !== 'weekly_reports') throw new Error(`unexpected table: ${table}`)
      return report
    })
    const repository = createSupabaseWeeklyRepository({ from } as never)

    await expect(repository.getSheet('p1', '2026-07-20')).resolves.toEqual({ ok: true, data: null })
    expect(from).toHaveBeenCalledTimes(1)
    for (const method of ['insert', 'upsert', 'update', 'delete']) {
      expect(report[method]).not.toHaveBeenCalled()
    }
  })

  it('weekly: row query failure is not disguised as an empty sheet and never backfills rows', async () => {
    const report = queryBuilder({
      data: {
        id: 'wr1', project_id: 'p1', week_start: '2026-07-20', title: '주간', updated_at: '2026-07-20T01:00:00Z',
      },
      error: null,
    })
    const rows = queryBuilder({ data: null, error: { code: '08006' } })
    const from = vi.fn((table: string) => table === 'weekly_reports' ? report : rows)
    const repository = createSupabaseWeeklyRepository({ from } as never)

    await expect(repository.getSheet('p1', '2026-07-20')).resolves.toEqual({
      ok: false,
      errorCode: 'WEEKLY_ROWS_READ_FAILED',
      retryable: true,
    })
    expect(from).toHaveBeenCalledWith('weekly_report_rows')
    for (const builder of [report, rows]) {
      for (const method of ['insert', 'upsert', 'update', 'delete']) {
        expect(builder[method]).not.toHaveBeenCalled()
      }
    }
  })

  it('WBS: a project query failure stays distinct from a project with no WBS rows', async () => {
    const responses: Record<string, QueryResponse> = {
      projects: { data: null, error: { code: '08006' } },
      wbs_items: { data: [], error: null },
      holidays: { data: [], error: null },
      task_dependencies: { data: [], error: null },
    }
    const repository = createSupabaseWbsRepository({
      from: vi.fn((table: string) => queryBuilder(responses[table])),
    } as never)

    await expect(repository.getProjectSnapshot('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'WBS_PROJECT_READ_FAILED',
      retryable: true,
    })
  })

  it('WBS: wbs_items.depends 를 의존성으로 합성해 실제 행과 함께 돌려준다', async () => {
    // 두 축이 갈려 있어 import 로 들어온 선행이 봇에게 보이지 않던 것을 고친 자리(2026-08-28).
    const responses: Record<string, QueryResponse> = {
      projects: { data: { id: 'p1', base_date: '2026-08-28' }, error: null },
      wbs_items: {
        data: [
          { id: 'i1', project_id: 'p1', code: 'A', name: '선행', external_ref: 'mes/T1', depends: null },
          { id: 'i2', project_id: 'p1', code: 'B', name: '후행', external_ref: 'mes/T2', depends: ['mes/T1', 'mes/GONE'] },
        ],
        error: null,
      },
      holidays: { data: [], error: null },
      task_dependencies: { data: [], error: null },
    }
    const repository = createSupabaseWbsRepository({
      from: vi.fn((table: string) => queryBuilder(responses[table])),
    } as never)

    const result = await repository.getProjectSnapshot('p1')
    expect(result.ok).toBe(true)
    const dependencies = (result as { data: { dependencies: unknown[] } }).data.dependencies
    expect(dependencies).toEqual([
      { id: 'spec:i1>i2', projectId: 'p1', predecessorId: 'i1', successorId: 'i2', type: 'FS', lagDays: 0, origin: 'spec' },
    ])
  })

  it('WBS: 합성 의존성의 projectId 가 어긋나면 봇 응답이 통째로 죽는다 — 스코프를 지킨다', () => {
    // ai/tools/wbs.ts 의 every(d => d.projectId === projectId) 는 어긋나면
    // repositoryScopeViolation() 을 내 답변 전체를 버린다. 성능 저하가 아니라 기능 정지다.
    const responses: Record<string, QueryResponse> = {
      projects: { data: { id: 'p1', base_date: null }, error: null },
      wbs_items: {
        data: [
          { id: 'i1', project_id: 'p1', code: 'A', name: '선행', external_ref: 'mes/T1', depends: null },
          { id: 'i2', project_id: 'p1', code: 'B', name: '후행', external_ref: 'mes/T2', depends: ['mes/T1'] },
        ],
        error: null,
      },
      holidays: { data: [], error: null },
      task_dependencies: { data: [], error: null },
    }
    const repository = createSupabaseWbsRepository({
      from: vi.fn((table: string) => queryBuilder(responses[table])),
    } as never)

    return repository.getProjectSnapshot('p1').then(result => {
      const dependencies = (result as { data: { dependencies: { projectId: string }[] } }).data.dependencies
      expect(dependencies.every(d => d.projectId === 'p1')).toBe(true)
    })
  })

  it('meetings: exception read failure does not revive cancelled occurrences as valid data', async () => {
    const meeting = {
      id: 'm1', project_id: 'p1', title: '주간회의', meeting_date: '2026-07-20',
      start_time: '10:00', end_time: '11:00', location: null, category: 'routine', recurrence: 'weekly',
      recurrence_until: null, created_by: 'u1', created_by_name: '홍길동', created_at: 't0', updated_at: 't1',
      meeting_attendees: [],
    }
    const from = vi.fn((table: string) => queryBuilder(
      table === 'meetings'
        ? { data: [meeting], error: null }
        : { data: null, error: { code: '08006' } },
    ))
    const repository = createSupabaseMeetingRepository({ from } as never)

    await expect(repository.listProjectMeetings('p1', '2026-07-20', '2026-07-27')).resolves.toEqual({
      ok: false,
      errorCode: 'MEETING_EXCEPTIONS_READ_FAILED',
      retryable: true,
    })
  })

  it('attendance: valid zero rows is successful and the query never selects note', async () => {
    const query = queryBuilder({ data: [], error: null })
    const from = vi.fn(() => query)
    const repository = createSupabaseAttendanceRepository({ from } as never)

    await expect(repository.listRecords('p1', '2026-07-20', '2026-07-26')).resolves.toEqual({
      ok: true,
      data: [],
    })
    const select = query.select as ReturnType<typeof vi.fn>
    expect(select).toHaveBeenCalledOnce()
    expect(String(select.mock.calls[0][0])).not.toContain('note')
    expect(String(select.mock.calls[0][0])).toContain('project_id')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('attendance: rejects a member joined from another project before exposing its name', async () => {
    const attendance = queryBuilder({
      data: [{
        id: 'a1', project_id: 'p1', member_id: 'member-p2', date: '2026-07-20', type: 'work',
      }],
      error: null,
    })
    const members = queryBuilder({
      data: [{ id: 'member-p2', project_id: 'p2', name: '다른 프로젝트 사용자', teams: { code: 'ERP' } }],
      error: null,
    })
    const from = vi.fn((table: string) => table === 'attendance_records' ? attendance : members)
    const repository = createSupabaseAttendanceRepository({ from } as never)

    const result = await repository.listRecords('p1', '2026-07-20', '2026-07-20')
    expect(result).toEqual({
      ok: false,
      errorCode: 'ATTENDANCE_MEMBER_SCOPE_INVALID',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('다른 프로젝트 사용자')
    expect(from).toHaveBeenNthCalledWith(2, 'project_members')
    expect(members.eq).toHaveBeenCalledWith('project_id', 'p1')
  })

  it('attendance: resolves member metadata through an explicit project-scoped read', async () => {
    const attendance = queryBuilder({
      data: [{ id: 'a1', project_id: 'p1', member_id: 'member-p1', date: '2026-07-20', type: 'remote' }],
      error: null,
    })
    const members = queryBuilder({
      data: [{ id: 'member-p1', project_id: 'p1', name: '프로젝트 사용자', teams: { code: 'ERP' } }],
      error: null,
    })
    const repository = createSupabaseAttendanceRepository({
      from: vi.fn((table: string) => table === 'attendance_records' ? attendance : members),
    } as never)

    await expect(repository.listRecords('p1', '2026-07-20', '2026-07-20')).resolves.toEqual({
      ok: true,
      data: [{
        id: 'a1', projectId: 'p1', memberId: 'member-p1', memberName: '프로젝트 사용자',
        teamCode: 'ERP', date: '2026-07-20', type: 'remote',
      }],
    })
    expect(String((attendance.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('project_members')
    expect(String((members.select as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('note')
  })
})
