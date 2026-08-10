import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트 · 팀 마스터 캐시를 모킹해 게이트·검증·프로젝트 스코프만 본다.
// 프로젝트 팀은 이 프로젝트 관리자만 손댈 수 있다(0071 §4) — 전역 teams.ts(슈퍼유저 전용)와는
// 가드가 다르고, 회의록 시드 폴더도 만들지 않는다(스펙 §5) — from('minute_folders') 호출 자체를
// 차단해 그 계약을 무너뜨리는 회귀를 즉시 실패로 드러낸다.
const { db, fromCalls, createAdminClient, refreshTeams, requireProjectAdmin, teamsSync } = vi.hoisted(() => {
  const db = {
    teams: [] as Array<Record<string, unknown>>,
    inserted: { teams: [] as Array<Record<string, unknown>> },
    updated: [] as Array<{ patch: unknown; id: unknown }>,
  }
  const fromCalls: string[] = []
  const table = () => {
    const rows = () => db.teams
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((col, v) => filters.push([String(col), v])),
      order: chain(),
      limit: chain(),
      maybeSingle: async () => {
        const found = rows().find(r => filters.every(([c, v]) => (r[c] ?? null) === v))
        return { data: found ?? (filters.length === 0 ? rows()[0] ?? null : null), error: null }
      },
      insert: async (row: unknown) => {
        const arr = (Array.isArray(row) ? row : [row]) as Array<Record<string, unknown>>
        db.inserted.teams.push(...arr)
        return { error: null }
      },
      // .eq() 를 여러 번 받아 컬럼별로 누적한다(updateProjectTeam 의 .eq('id').eq('project_id')
      // 이중 필터를 정확히 흉내내야 "전역 행·타 프로젝트 행은 0행"이 제대로 검증된다.
      update: (patch: unknown) => {
        const updFilters: Array<[string, unknown]> = []
        const upd: Record<string, unknown> = {
          eq: (col: string, v: unknown) => { updFilters.push([col, v]); return upd },
          select: async (_cols: string) => {
            const target = rows().find(r => updFilters.every(([c, v]) => (r[c] ?? null) === v))
            if (target) db.updated.push({ patch, id: target.id })
            return { data: target ? [{ id: target.id }] : [], error: null }
          },
        }
        return upd
      },
    })
    return q
  }
  const createAdminClient = vi.fn(() => ({
    from: (n: string) => {
      fromCalls.push(n)
      // 프로젝트 팀 액션은 'teams' 테이블만 만진다 — 다른 테이블(특히 minute_folders) 접근은
      // 회의록 시드 폴더 계약 위반이라 즉시 던져 테스트를 실패시킨다.
      if (n !== 'teams') throw new Error(`프로젝트 팀 액션이 ${n} 테이블을 건드렸습니다(전역 팀 축 위반)`)
      return table()
    },
  }))
  const refreshTeams = vi.fn(async () => true)
  const requireProjectAdmin = vi.fn()
  const teamsSync = vi.fn()
  return { db, fromCalls, createAdminClient, refreshTeams, requireProjectAdmin, teamsSync }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams, teamsSync }))

import { addProjectTeam, updateProjectTeam, copyGlobalTeams } from '@/app/actions/projectTeams'

const ADMIN_ACTOR = {
  userId: 'u-admin', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map([['p1', 'admin']]),
}
const asAdmin = () => requireProjectAdmin.mockResolvedValue({ ok: true, actor: ADMIN_ACTOR })

describe('프로젝트 팀 관리 서버액션', () => {
  beforeEach(() => {
    db.teams = []
    db.inserted.teams = []
    db.updated = []
    fromCalls.length = 0
    createAdminClient.mockClear()
    refreshTeams.mockClear()
    requireProjectAdmin.mockReset()
    teamsSync.mockReset()
  })

  describe('addProjectTeam', () => {
    it('프로젝트 관리자가 아니면 거부(fail-closed)', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await addProjectTeam('p1', '신팀')).toEqual({ ok: false, error: '권한 없음' })
      expect(createAdminClient).not.toHaveBeenCalled()
    })

    it('예약어·빈 이름 거부', async () => {
      asAdmin()
      expect((await addProjectTeam('p1', '산출물')).ok).toBe(false)
      expect((await addProjectTeam('p1', '   ')).ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('동일 프로젝트 내 중복 코드는 거부', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', project_id: 'p1', sort_order: 0 }]
      const r = await addProjectTeam('p1', 'ERP')
      expect(r.ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('전역·타 프로젝트의 동명 팀은 막지 않는다(복합 유니크와 일치)', async () => {
      asAdmin()
      db.teams = [
        { id: 't-global', code: 'ERP', project_id: null, sort_order: 0 },
        { id: 't-other', code: 'ERP', project_id: 'p2', sort_order: 0 },
      ]
      const r = await addProjectTeam('p1', 'ERP')
      expect(r.ok).toBe(true)
      expect(db.inserted.teams).toHaveLength(1)
    })

    it('성공: teams insert(project_id 포함) + refreshTeams, 시드 폴더는 절대 만들지 않는다', async () => {
      asAdmin()
      const r = await addProjectTeam('p1', ' 신팀 ')
      expect(r.ok).toBe(true)
      expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', name: '신팀', project_id: 'p1' })
      expect(refreshTeams).toHaveBeenCalled()
      expect(fromCalls).not.toContain('minute_folders')
    })
  })

  describe('updateProjectTeam', () => {
    it('프로젝트 관리자가 아니면 거부', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await updateProjectTeam('p1', 't1', { active: false })).toEqual({ ok: false, error: '권한 없음' })
    })

    it('빈 patch 거부', async () => {
      asAdmin()
      expect((await updateProjectTeam('p1', 't1', {})).ok).toBe(false)
    })

    // 조용한 no-op 을 성공으로 위장하지 않는다(teams.ts updateTeam·revokeProjectInvite 와 동일 관례) —
    // id 가 존재하지 않거나 전역/타 프로젝트 행이면 이중 .eq 필터에 걸려 0행이 된다.
    it('0행 매치(전역 행·타 프로젝트 행·존재하지 않는 id)는 실패로 보고한다(조용한 no-op 금지)', async () => {
      asAdmin()
      db.teams = [
        { id: 't-global', code: 'ERP', project_id: null },
        { id: 't-other', code: 'MES', project_id: 'p2' },
      ]
      expect(await updateProjectTeam('p1', 't-global', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(await updateProjectTeam('p1', 't-other', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(await updateProjectTeam('p1', 'no-such-id', { active: false }))
        .toEqual({ ok: false, error: '이 프로젝트의 팀이 아니거나 존재하지 않습니다.' })
      expect(db.updated).toHaveLength(0)
      expect(refreshTeams).not.toHaveBeenCalled()
    })

    it('성공: 이 프로젝트 소속 행만 스네이크케이스로 update', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', project_id: 'p1' }]
      const r = await updateProjectTeam('p1', 't-mine', { active: false, progressVisible: true, sortOrder: 3 })
      expect(r.ok).toBe(true)
      expect(db.updated[0]).toMatchObject({ id: 't-mine', patch: { active: false, progress_visible: true, sort_order: 3 } })
      expect(refreshTeams).toHaveBeenCalled()
    })
  })

  describe('copyGlobalTeams', () => {
    it('프로젝트 관리자가 아니면 거부', async () => {
      requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
      expect(await copyGlobalTeams('p1')).toEqual({ ok: false, error: '권한 없음' })
    })

    it('이미 프로젝트 팀이 정의되어 있으면 거부', async () => {
      asAdmin()
      db.teams = [{ id: 't-mine', code: 'ERP', project_id: 'p1', sort_order: 0 }]
      const r = await copyGlobalTeams('p1')
      expect(r.ok).toBe(false)
      expect(db.inserted.teams).toHaveLength(0)
    })

    it('성공: 전역 활성 팀만 복사하고 MDM 의 progressVisible=false 를 보존한다', async () => {
      asAdmin()
      teamsSync.mockReturnValue([
        { id: 'g-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: null },
        { id: 'g-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false, projectId: null },
        { id: 'g-old', code: 'OLD', sortOrder: 5, active: false, progressVisible: true, projectId: null },
      ])
      const r = await copyGlobalTeams('p1')
      expect(r.ok).toBe(true)
      expect(db.inserted.teams).toHaveLength(2)
      expect(db.inserted.teams).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PMO', project_id: 'p1', progress_visible: true }),
        expect.objectContaining({ code: 'MDM', project_id: 'p1', progress_visible: false }),
      ]))
      expect(db.inserted.teams.some(t => t.code === 'OLD')).toBe(false)
      expect(refreshTeams).toHaveBeenCalled()
    })
  })
})
