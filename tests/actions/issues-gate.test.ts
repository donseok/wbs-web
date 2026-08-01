import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다. 각 테스트가 state.client 를
// 지정하지 않으면 호출 즉시 throw — "게이트 전 DB 접근 없음"을 기본값으로 강제한다.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
// 가드 자체의 판정은 tests/authz/guards.test.ts 가 본다. 여기서는 이슈 액션이 어떤 가드를 쓰는지만 본다.
const { requireProjectMember, requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectMember, requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getSession } from '@/lib/auth'
import { createIssue, updateIssue, updateIssueProgress, deleteIssue } from '@/app/actions/issues'

const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const
const ACTOR = { userId: 'me', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'member']]) }

/** 이 프로젝트의 멤버지만 관리자는 아니다 — 남의 이슈 전체 편집·삭제는 거부돼야 한다. */
function asMember() {
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue(ACTOR)
}
/** 프로젝트 역할이 없는 조회 전용 사용자 — 쓰기는 전부 거부. */
function asViewer() {
  requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue(ACTOR)
}
/** 이 프로젝트의 관리자 — 남의 이슈도 편집·삭제할 수 있다. */
function asProjectAdmin() {
  requireProjectMember.mockResolvedValue({ ok: true, actor: ACTOR })
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
}
/** 비로그인 — 가드가 '로그인 필요'를 내고 getActor 도 null 이다. */
function asAnon() {
  requireProjectMember.mockResolvedValue({ ok: false, error: '로그인 필요' })
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
  getActor.mockResolvedValue(null)
}

const INPUT = {
  title: '테스트 이슈',
  body: '',
  severity: 'medium' as const,
  assigneeMemberIds: [] as string[],
  startDate: null,
  dueDate: null,
  megaCode: '00' as const,
  majorName: '기준정보관리',
  subProcess: '기준정보 등록',
  ownerDepartment: '경영관리팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview' as const,
  sourceDetail: '현업 인터뷰',
}

/** 선검증 조회(maybeSingle) 스텁 — from().select().eq().maybeSingle() 체인만 지원. */
function sbWithCurrent(current: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: current })) })) })),
      update: vi.fn(() => { throw new Error('게이트 전 update 금지') }),
      delete: vi.fn(() => { throw new Error('게이트 전 delete 금지') }),
      insert: vi.fn(() => { throw new Error('게이트 전 insert 금지') }),
      ...extra,
    })),
  }
}

/**
 * issue_major_processes resolve-or-create 스텁(0062) —
 * select('id').eq(project_id).eq(mega_code).eq(name).maybeSingle() 조회는 selectResults
 * 큐에서 순서대로 소진하고(23505 경합 재조회 대비 마지막 결과를 반복), insert().select().single()
 * 은 insertResult 를 돌려준다. insert 스파이를 노출해 "기존 행 재사용 시 미호출"을 검증한다.
 */
type MajorRow = { id: string }
type MajorErr = { message: string; code?: string }
function majorProcessesTable(opts: {
  selectResults: Array<{ data: MajorRow | null; error: MajorErr | null }>
  insertResult?: { data: MajorRow | null; error: MajorErr | null }
}) {
  let selectCall = 0
  const maybeSingle = vi.fn(async () => {
    const r = opts.selectResults[Math.min(selectCall, opts.selectResults.length - 1)]
    selectCall += 1
    return r
  })
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => opts.insertResult ?? { data: null, error: { message: '예상치 못한 major insert 호출' } }),
    })),
  }))
  const table = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
    })),
    insert,
  }
  return { table, insert }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  getActor.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  vi.mocked(getSession).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
})

describe('권한 게이트 — 비로그인은 전부 거부 + DB 무접근', () => {
  it.each([
    ['createIssue', () => createIssue('p1', { ...INPUT })],
    ['updateIssue', () => updateIssue('i1', { ...INPUT })],
    ['updateIssueProgress', () => updateIssueProgress('i1', { status: 'in_progress', expectedStatus: 'open' })],
    ['deleteIssue', () => deleteIssue('i1')],
  ] as const)('%s: 비로그인 → ok:false, DB 미호출', async (_name, run) => {
    asAnon()
    const res = await run()
    expect(res).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('권한 게이트 — 조회 전용(프로젝트 역할 없음)은 쓰지 못한다', () => {
  it.each([
    ['createIssue', () => createIssue('p1', { ...INPUT })],
    ['updateIssueProgress', () => updateIssueProgress('i1', { status: 'in_progress', expectedStatus: 'open' })],
  ] as const)('%s: 멤버 가드에서 거부 + DB 미호출', async (_name, run) => {
    asViewer()
    const res = await run()
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 전체 편집·삭제는 '작성자 본인'과 OR 이므로 소유권 조회까지는 간다 — 거기서 끊긴다.
  it('updateIssue·deleteIssue: 남의 이슈는 소유권 조회까지만 하고 거부한다', async () => {
    asViewer()
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other' })
    expect(await updateIssue('i1', { ...INPUT })).toMatchObject({ ok: false, error: '권한 없음' })
    expect(await deleteIssue('i1')).toMatchObject({ ok: false, error: '권한 없음' })
  })
})

describe('작성자/관리자 게이트 — updateIssue·deleteIssue', () => {
  it('멤버여도 작성자도 관리자도 아니면 권한 없음 (선검증 조회까지만, update/delete 미호출)', async () => {
    asMember()
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other' })
    const up = await updateIssue('i1', { ...INPUT })
    expect(up).toMatchObject({ ok: false, error: '권한 없음' })
    const del = await deleteIssue('i1')
    expect(del).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('이슈가 없으면 안내 반환', async () => {
    asMember()
    state.client = sbWithCurrent(null)
    const res = await updateIssue('i1', { ...INPUT })
    expect(res.ok).toBe(false)
  })

  // 대상 이슈의 프로젝트를 못 읽으면 관리자 판정 자체가 불가능하다 — 쓰기로 나아가지 않는다.
  it('프로젝트 확정에 실패하면 그 사유로 중단하고 DB 에 접근하지 않는다', async () => {
    asMember()
    resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await deleteIssue('i1')
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자는 남의 이슈도 편집할 수 있다', async () => {
    asProjectAdmin()
    state.client = {
      from: vi.fn((table: string) => {
        if (table === 'issue_assignees') {
          return { delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) }
        }
        if (table === 'issue_major_processes') {
          return majorProcessesTable({ selectResults: [{ data: { id: 'major-1' }, error: null }] }).table
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { project_id: 'p1', created_by: 'other' } })) })) })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'i1' }, error: null })) })) })),
          })),
        }
      }),
    }
    const res = await updateIssue('i1', { ...INPUT })
    expect(res).toMatchObject({ ok: true })
  })
})

describe('updateIssue — 회의록 원천 불변성/0055 이전 이슈 최초 분류', () => {
  function updateClient(minuteLinkResult: {
    data: { id: string } | null
    error: { message: string } | null
  }, currentSourceType: string | null = null) {
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'i1', pi_issue_code: 'PI-I-00-01' },
            error: null,
          })),
        })),
      })),
    }))
    return {
      update,
      client: {
        from: vi.fn((table: string) => {
          if (table === 'issues') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      project_id: 'p1',
                      created_by: 'me',
                      mega_code: null,
                      source_type: currentSourceType,
                    },
                    error: null,
                  })),
                })),
              })),
              update,
            }
          }
          if (table === 'issue_links') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => minuteLinkResult),
                    })),
                  })),
                })),
              })),
            }
          }
          if (table === 'issue_assignees') {
            return {
              delete: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            }
          }
          // 원천 검증을 통과한 뒤에만 도달한다 — 기존 major 행 재사용 경로.
          if (table === 'issue_major_processes') {
            return majorProcessesTable({ selectResults: [{ data: { id: 'major-1' }, error: null }] }).table
          }
          throw new Error(`unexpected table: ${table}`)
        }),
      },
    }
  }

  it('기존 source_type=null이어도 불변 minute_block 링크가 있으면 minutes 최초 분류를 허용한다', async () => {
    asMember()
    const fixture = updateClient({ data: { id: 'link-1' }, error: null })
    state.client = fixture.client

    const result = await updateIssue('i1', { ...INPUT, sourceType: 'minutes' })

    expect(result).toMatchObject({ ok: true, piIssueCode: 'PI-I-00-01' })
    expect(fixture.update).toHaveBeenCalledOnce()
  })

  it('minute_block 링크가 없거나 조회가 실패하면 minutes 사칭을 fail-closed로 막는다', async () => {
    asMember()
    const noLink = updateClient({ data: null, error: null })
    state.client = noLink.client
    expect(await updateIssue('i1', { ...INPUT, sourceType: 'minutes' })).toMatchObject({
      ok: false,
      error: '회의록 원천은 검증된 회의록 링크가 있는 이슈에만 지정할 수 있습니다.',
    })
    expect(noLink.update).not.toHaveBeenCalled()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lookupFailure = updateClient({ data: null, error: { message: 'lookup failed' } })
    state.client = lookupFailure.client
    expect(await updateIssue('i1', { ...INPUT, sourceType: 'minutes' })).toMatchObject({
      ok: false,
      error: '권한을 확인할 수 없어 중단했습니다.',
    })
    expect(lookupFailure.update).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('이미 다른 원천으로 분류된 이슈는 링크 유무와 무관하게 minutes로 바꾸지 못한다', async () => {
    asMember()
    const fixture = updateClient({ data: { id: 'link-1' }, error: null }, 'interview')
    state.client = fixture.client

    expect(await updateIssue('i1', { ...INPUT, sourceType: 'minutes' })).toMatchObject({
      ok: false,
      error: '등록된 이슈 원천을 회의록 원천으로 변경할 수 없습니다.',
    })
    expect(fixture.update).not.toHaveBeenCalled()
  })
})

describe('updateIssueProgress — 전환 검증 + CAS', () => {
  it('전환 맵에 없는 전환은 거부 (resolved→on_hold)', async () => {
    asMember()
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other', status: 'resolved', resolved_at: '2026-07-20T00:00:00Z' })
    const res = await updateIssueProgress('i1', { status: 'on_hold', expectedStatus: 'resolved' })
    expect(res.ok).toBe(false)
  })
  it('status 만 있고 expectedStatus 가 없으면 검증 에러 (DB 미도달)', async () => {
    asMember()
    const res = await updateIssueProgress('i1', { status: 'in_progress' })
    expect(res).toMatchObject({ ok: false, error: '상태 기준값이 없습니다. 새로고침 후 다시 시도하세요.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('CAS 0행이면 conflict:true (다른 사용자 선변경)', async () => {
    asMember()
    state.client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { project_id: 'p1', created_by: 'other', status: 'open', resolved_at: null } })) })) })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) })),
        })),
      })),
    }
    const res = await updateIssueProgress('i1', { status: 'in_progress', expectedStatus: 'open' })
    expect(res).toMatchObject({ ok: false, conflict: true })
  })
  it('클라이언트가 관측한 expectedStatus 가 서버 최신 상태와 다르면 즉시 conflict (stale 재오픈 저장 차단, update 미호출)', async () => {
    // A 가 open 을 보는 동안 B 가 resolved 로 바꿈. A 의 in_progress 저장(expectedStatus:'open')은
    // 선검증에서 즉시 conflict — 서버가 방금 읽은 status(resolved)가 아니라 클라이언트 관측값이 기준.
    asMember()
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other', status: 'resolved', resolved_at: '2026-07-20T00:00:00Z' })
    const res = await updateIssueProgress('i1', { status: 'in_progress', expectedStatus: 'open' })
    expect(res).toMatchObject({ ok: false, conflict: true })
  })
})

describe('입력 검증 — createIssue', () => {
  it('정규화한 분석 메타를 저장하고 발급된 PI 업무키를 반환한다', async () => {
    asMember()
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: 'i1', issue_no: 31, pi_issue_code: 'PI-I-00-04' },
          error: null,
        })),
      })),
    }))
    state.client = {
      from: vi.fn((table: string) => {
        if (table === 'issues') return { insert }
        if (table === 'issue_major_processes') {
          return majorProcessesTable({ selectResults: [{ data: { id: 'major-1' }, error: null }] }).table
        }
        if (table === 'issue_assignees') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    }

    const result = await createIssue('p1', {
      ...INPUT,
      subProcess: '  기준정보 등록  ',
      ownerDepartment: '  경영관리팀  ',
      relatedSystems: [' ERP ', 'MDM', 'ERP'],
      sourceDetail: '  현업 인터뷰  ',
    })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      mega_code: '00',
      major_id: 'major-1',
      sub_process: '기준정보 등록',
      owner_department: '경영관리팀',
      related_systems: ['ERP', 'MDM'],
      source_type: 'interview',
      source_detail: '현업 인터뷰',
    }))
    expect(result).toEqual({
      ok: true,
      id: 'i1',
      issueNo: 31,
      piIssueCode: 'PI-I-00-04',
    })
  })

  it('빈 제목 거부 (게이트 통과 후에도 DB insert 미도달)', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, title: '   ' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('잘못된 날짜 형식 거부', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, dueDate: '2026-02-30' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('시작일이 목표일보다 늦으면 거부', async () => {
    asMember()
    const res = await createIssue('p1', {
      ...INPUT,
      startDate: '2026-08-04',
      dueDate: '2026-08-03',
    })
    expect(res).toMatchObject({ ok: false, error: '이슈 시작일은 목표 해결일보다 늦을 수 없습니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('담당자 상한(20명) 초과 거부 (DB 미도달)', async () => {
    asMember()
    const many = Array.from({ length: 21 }, (_, i) => `m${i}`)
    const res = await createIssue('p1', { ...INPUT, assigneeMemberIds: many })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('최대 20명')
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('담당자가 배열이 아니면 거부 — 서버 액션 인자 위조 방어 (DB 미도달)', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, assigneeMemberIds: 'm1' as never })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('Mega 화이트리스트 밖의 코드는 거부한다', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, megaCode: '99' as never })
    expect(res).toMatchObject({ ok: false, error: '잘못된 Mega 영역입니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('Sub Process와 주관부서는 공백일 수 없다', async () => {
    asMember()
    const noProcess = await createIssue('p1', { ...INPUT, subProcess: '  ' })
    const noOwner = await createIssue('p1', { ...INPUT, ownerDepartment: '  ' })
    expect(noProcess.ok).toBe(false)
    expect(noOwner.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('Major Process 이름은 공백일 수 없다 (DB 미도달)', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, majorName: '   ' })
    expect(res).toMatchObject({ ok: false, error: 'Major Process를 입력하세요.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('일반 등록에서는 회의록 원천을 사칭할 수 없다', async () => {
    asMember()
    const res = await createIssue('p1', { ...INPUT, sourceType: 'minutes' })
    expect(res).toMatchObject({
      ok: false,
      error: '회의록 원천은 회의록의 이슈 등록 기능에서만 선택할 수 있습니다.',
    })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('createIssue — Major Process resolve-or-create(0062)', () => {
  function issueInsertOk() {
    return vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: 'i1', issue_no: 7, pi_issue_code: 'PI-I-00-07' },
          error: null,
        })),
      })),
    }))
  }
  function clientWith(major: ReturnType<typeof majorProcessesTable>, issueInsert: ReturnType<typeof issueInsertOk>) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'issue_major_processes') return major.table
        if (table === 'issues') return { insert: issueInsert }
        if (table === 'issue_assignees') {
          return { delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    }
  }

  it('같은 이름이면 기존 major 행을 재사용한다 (major insert 미호출)', async () => {
    asMember()
    const major = majorProcessesTable({ selectResults: [{ data: { id: 'major-1' }, error: null }] })
    const insert = issueInsertOk()
    state.client = clientWith(major, insert)

    const res = await createIssue('p1', { ...INPUT })

    expect(res).toMatchObject({ ok: true, id: 'i1' })
    expect(major.insert).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ major_id: 'major-1' }))
  })

  it('선행 조회가 실패하면 그 사유로 중단하고 이슈 insert 에 도달하지 않는다 (fail-closed)', async () => {
    asMember()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const major = majorProcessesTable({ selectResults: [{ data: null, error: { message: 'select boom' } }] })
    const insert = issueInsertOk()
    state.client = clientWith(major, insert)

    const res = await createIssue('p1', { ...INPUT })

    expect(res).toMatchObject({ ok: false, error: 'Major Process 정보를 확인할 수 없어 중단했습니다.' })
    expect(major.insert).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('동시 등록 경합(23505)은 승자 행 재조회로 수렴해 이슈 등록에 성공한다', async () => {
    asMember()
    const major = majorProcessesTable({
      selectResults: [
        { data: null, error: null }, // 최초 조회: 아직 없음 → insert 시도
        { data: { id: 'major-2' }, error: null }, // 경합 재조회: 먼저 들어간 승자 행
      ],
      insertResult: { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    })
    const insert = issueInsertOk()
    state.client = clientWith(major, insert)

    const res = await createIssue('p1', { ...INPUT })

    expect(res).toMatchObject({ ok: true, id: 'i1' })
    expect(major.insert).toHaveBeenCalledOnce()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ major_id: 'major-2' }))
  })
})

describe('updateIssueProgress — 담당자 검증', () => {
  it('배열 아님·비문자열 원소는 DB 도달 전에 거부', async () => {
    asMember()
    const bad = await updateIssueProgress('i1', { assigneeMemberIds: 'm1' as never })
    expect(bad.ok).toBe(false)
    const badElem = await updateIssueProgress('i1', { assigneeMemberIds: [42] as never })
    expect(badElem.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
