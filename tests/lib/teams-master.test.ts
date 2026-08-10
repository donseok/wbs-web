import { beforeEach, describe, expect, it, vi } from 'vitest'

// llm-override 테스트와 동일 전략: service_role 클라이언트를 가짜 테이블로 대체.
// 모듈 초기화 top-level await 보다 모킹이 먼저 걸리도록 vi.hoisted 사용,
// 각 테스트는 vi.resetModules + 동적 import 로 콜드스타트를 재현한다.
const { db, createAdminClient } = vi.hoisted(() => {
  const db = {
    rows: null as Array<Record<string, unknown>> | null,
    error: null as { message: string } | null,
  }
  const createAdminClient = vi.fn(() => ({
    from: () => ({
      select: () => ({
        order: () => ({
          order: async () => ({ data: db.rows, error: db.error }),
        }),
      }),
    }),
  }))
  return { db, createAdminClient }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const ROWS = [
  { id: 't1', code: 'PMO', sort_order: 0, active: true, progress_visible: true },
  { id: 't2', code: '신팀', sort_order: 5, active: true, progress_visible: true },
  { id: 't3', code: '구팀', sort_order: 6, active: false, progress_visible: true },
]

async function importMaster() {
  vi.resetModules()
  return import('@/lib/teams/master')
}

describe('teams/master', () => {
  beforeEach(() => { db.rows = null; db.error = null })

  it('로드 성공 시 DB 값을 반환하고 활성 코드만 추린다', async () => {
    db.rows = ROWS
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.activeTeamCodesSync()).toEqual(['PMO', '신팀'])
    expect(m.isRegisteredTeamCode('구팀')).toBe(true)
    expect(m.isActiveTeamCode('구팀')).toBe(false)
    expect(m.isActiveTeamCode('없는팀')).toBe(false)
  })

  it('콜드스타트 로드 실패 시 DEFAULT_TEAMS 폴백', async () => {
    db.error = { message: 'down' }
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
  })

  it('빈 teams 테이블은 폴백 유지(전 화면 팀 축 소실 방지)', async () => {
    db.rows = []
    const m = await importMaster()
    expect(m.activeTeamCodesSync()).toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM'])
  })

  it('갱신 실패 시 직전 유효값 유지(stale ≠ 폴백)', async () => {
    db.rows = ROWS
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toContain('신팀')
    db.rows = null
    db.error = { message: 'down' }
    await m.refreshTeams()
    expect(m.teamsSync().map(t => t.code)).toContain('신팀')
  })

  it('refreshTeams는 저장 직후 최신 스냅샷을 반영한다', async () => {
    db.rows = ROWS
    const m = await importMaster()
    db.rows = [...ROWS, { id: 't4', code: '추가팀', sort_order: 7, active: true, progress_visible: true }]
    await m.refreshTeams()
    expect(m.activeTeamCodesSync()).toContain('추가팀')
  })

  it('프로젝트 행만 있고 전역 행이 0이면 로드 실패로 직전 값 유지(전역 축 소실 방지)', async () => {
    db.rows = ROWS // 전역 3행으로 정상 기동
    const m = await importMaster()
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])

    // 갱신 시점에 전역 행이 전부 사라지고 프로젝트 행만 남는 이상 상태.
    db.rows = [{ id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'p1' }]
    const ok = await m.refreshTeams()
    expect(ok).toBe(false) // 전역 0건은 빈 목록과 동치로 취급되어 로드 실패
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀']) // 직전 값 유지
  })

  it('project_id가 있는 행은 Team.projectId로 매핑되고 teamsSync()는 전역 행만 반환한다(봉쇄)', async () => {
    db.rows = [
      ...ROWS,
      { id: 'tp1', code: '개발', sort_order: 0, active: true, progress_visible: true, project_id: 'proj-1' },
    ]
    const m = await importMaster()

    // DB 행 → Team.projectId 매핑이 실값으로 통과한다.
    expect(m.teamsForProjectSync('proj-1').map(t => t.code)).toEqual(['개발'])
    expect(m.projectTeamRowsSync('proj-1')).toEqual([
      { id: 'tp1', code: '개발', sortOrder: 0, active: true, progressVisible: true, projectId: 'proj-1' },
    ])

    // 전역 접근자는 프로젝트 행 혼입 없이 여전히 전역 3행만 반환한다(봉쇄).
    expect(m.teamsSync().map(t => t.code)).toEqual(['PMO', '신팀', '구팀'])
    expect(m.teamsSync().some(t => t.projectId !== null)).toBe(false)
  })
})
