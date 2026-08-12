import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트 · 팀 마스터 캐시를 모킹해 게이트·검증·시드 폴더 생성만 본다.
// 팀 기준정보는 전역이라 프로젝트 관리자가 아니라 슈퍼유저만 손댈 수 있다(스펙 §4).
const { db, createAdminClient, refreshTeams, requireSuperuser } = vi.hoisted(() => {
  const db = {
    teams: [] as Array<Record<string, unknown>>,
    folders: [] as Array<Record<string, unknown>>,
    inserted: { teams: [] as unknown[], minute_folders: [] as unknown[] },
    updated: [] as Array<{ patch: unknown; id: unknown }>,
  }
  /** 체이너블 최소 모의 — eq/is/order/limit 는 자기 자신, maybeSingle 은 큐 결과. */
  const table = (name: 'teams' | 'minute_folders') => {
    const rows = () => (name === 'teams' ? db.teams : db.folders)
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((col, v) => filters.push([String(col), v])),
      is: chain((col, v) => filters.push([String(col), v])),
      order: chain(),
      limit: chain(),
      maybeSingle: async () => {
        const found = rows().find(r => filters.every(([c, v]) => (r[c] ?? null) === v))
        // sort_order 최대값 조회(내림차순 limit 1) 근사: 필터 없으면 첫 행
        return { data: found ?? (filters.length === 0 ? rows()[0] ?? null : null), error: null }
      },
      insert: async (row: unknown) => { db.inserted[name].push(row); return { error: null } },
      // update 체인도 eq/is 를 함께 받는다(updateTeam 의 .eq('id', id).is('project_id', null) 방어).
      // .select('id') 가 종결 — 실제로 매칭되는 행이 있어야 db.updated 에 반영된다(조용한 no-op
      // 을 성공으로 위장하지 않는 프로덕션 코드의 영향행 확인을 모의도 똑같이 강제한다).
      // .then 도 구현해 .select() 없이 바로 await 하는 경로까지 호환한다.
      update: (patch: unknown) => {
        let id: unknown
        let requireGlobal = false
        const finalize = () => {
          const target = rows().find(r => r.id === id && (!requireGlobal || (r.project_id ?? null) === null))
          if (target) db.updated.push({ patch, id })
          return { data: target ? [{ id }] : [], error: null }
        }
        const upd: Record<string, unknown> = {
          eq: (_c: string, v: unknown) => { id = v; return upd },
          is: (_c: string, v: unknown) => { requireGlobal = v === null; return upd },
          select: async (_cols: string) => finalize(),
          then: (resolve: (v: { error: null }) => void) => resolve({ error: finalize().error }),
        }
        return upd
      },
    })
    return q
  }
  const createAdminClient = vi.fn(() => ({ from: (n: 'teams' | 'minute_folders') => table(n) }))
  const refreshTeams = vi.fn(async () => true)
  const requireSuperuser = vi.fn()
  return { db, createAdminClient, refreshTeams, requireSuperuser }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireSuperuser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams }))

import { addTeam, updateTeam } from '@/app/actions/teams'

const SUPERUSER = {
  userId: 'u-super', teamCode: 'PMO', teamId: 't1', isSuperuser: true, projectRoles: new Map(),
}
const asSuperuser = () => requireSuperuser.mockResolvedValue({ ok: true, actor: SUPERUSER })

describe('팀 관리 서버액션', () => {
  beforeEach(() => {
    db.teams = []
    db.folders = []
    db.inserted.teams = []
    db.inserted.minute_folders = []
    db.updated = []
    createAdminClient.mockClear()
    refreshTeams.mockClear()
    requireSuperuser.mockReset()
  })

  it('슈퍼유저가 아니면 addTeam·updateTeam 거부(fail-closed)', async () => {
    requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await addTeam('신팀')).toEqual({ ok: false, error: '권한 없음' })
    expect(await updateTeam('t1', { active: false })).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('예약어·빈 이름 거부', async () => {
    asSuperuser()
    expect((await addTeam('산출물')).ok).toBe(false)
    expect((await addTeam('   ')).ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  it('중복 코드 거부', async () => {
    asSuperuser()
    db.teams = [{ id: 't-pmo', code: 'PMO', sort_order: 0 }]
    const r = await addTeam('PMO')
    expect(r.ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  it('성공: teams insert + 시드 루트 폴더 insert + refreshTeams', async () => {
    asSuperuser()
    const r = await addTeam(' 신팀 ')
    expect(r.ok).toBe(true)
    expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', name: '신팀' })
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, created_by: null })
    expect(refreshTeams).toHaveBeenCalled()
  })

  it('동명 시드 폴더가 이미 있으면 폴더 insert 는 생략하고 성공', async () => {
    asSuperuser()
    db.folders = [{ id: 'f1', code: undefined, name: '신팀', parent_id: null, created_by: null }]
    const r = await addTeam('신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(0)
  })

  // 0071 이후 project_id 로도 스코프해야 한다 — 프로젝트 루트 폴더가 같은 이름을 먼저 선점해도
  // 전역 루트 시드 dup-check 는 그 행을 무시하고 새로 만들어야 한다(post-0076 드리프트 회귀).
  it('동명 폴더가 다른 프로젝트 소속이면 전역 루트 시드는 별도로 생성된다', async () => {
    asSuperuser()
    db.folders = [{ id: 'pf1', name: '신팀', parent_id: null, created_by: null, project_id: 'p1' }]
    const r = await addTeam('신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(1)
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, created_by: null, project_id: null })
  })

  it('updateTeam: 빈 patch 거부, 정상 patch 는 스네이크케이스로 update', async () => {
    asSuperuser()
    db.teams = [{ id: 't1', code: 'PMO', project_id: null }]
    expect((await updateTeam('t1', {})).ok).toBe(false)
    const r = await updateTeam('t1', { active: false, progressVisible: true, sortOrder: 3 })
    expect(r.ok).toBe(true)
    expect(db.updated[0]).toMatchObject({ id: 't1', patch: { active: false, progress_visible: true, sort_order: 3 } })
    expect(refreshTeams).toHaveBeenCalled()
  })

  // 조용한 no-op 을 성공으로 위장하지 않는다(revokeProjectInvite 와 동일 관례) — id 가
  // 존재하지 않거나 프로젝트 팀(0071)이면 .is('project_id', null) 필터에 걸려 0행이 된다.
  it('updateTeam: 존재하지 않거나 프로젝트 팀인 id 는 실패로 보고한다(조용한 no-op 금지)', async () => {
    asSuperuser()
    db.teams = [{ id: 't-proj', code: 'ERP', project_id: 'p1' }]
    const r = await updateTeam('t-proj', { active: false })
    expect(r).toEqual({ ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' })
    expect(db.updated).toHaveLength(0)
    expect(refreshTeams).not.toHaveBeenCalled()

    const r2 = await updateTeam('no-such-id', { active: false })
    expect(r2).toEqual({ ok: false, error: '전역 팀이 아니거나 존재하지 않습니다.' })
  })
})
