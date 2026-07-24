import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · auth · admin 클라이언트 · 팀 마스터 캐시를 모킹해 게이트·검증·시드 폴더 생성만 본다.
const { db, createAdminClient, refreshTeams } = vi.hoisted(() => {
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
      update: (patch: unknown) => ({
        eq: async (_c: string, id: unknown) => { db.updated.push({ patch, id }); return { error: null } },
      }),
    })
    return q
  }
  const createAdminClient = vi.fn(() => ({ from: (n: 'teams' | 'minute_folders') => table(n) }))
  const refreshTeams = vi.fn(async () => true)
  return { db, createAdminClient, refreshTeams }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams }))

import { getMembership } from '@/lib/auth'
import { addTeam, updateTeam } from '@/app/actions/teams'

const asAdmin = () => vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' })

describe('팀 관리 서버액션', () => {
  beforeEach(() => {
    db.teams = []
    db.folders = []
    db.inserted.teams = []
    db.inserted.minute_folders = []
    db.updated = []
    createAdminClient.mockClear()
    refreshTeams.mockClear()
  })

  it('비-pmo_admin은 addTeam·updateTeam 거부(fail-closed)', async () => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor', teamCode: 'PMO', teamId: 't1' })
    expect((await addTeam('신팀')).ok).toBe(false)
    expect((await updateTeam('t1', { active: false })).ok).toBe(false)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('예약어·빈 이름 거부', async () => {
    asAdmin()
    expect((await addTeam('산출물')).ok).toBe(false)
    expect((await addTeam('   ')).ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  it('중복 코드 거부', async () => {
    asAdmin()
    db.teams = [{ id: 't-pmo', code: 'PMO', sort_order: 0 }]
    const r = await addTeam('PMO')
    expect(r.ok).toBe(false)
    expect(db.inserted.teams).toHaveLength(0)
  })

  it('성공: teams insert + 시드 루트 폴더 insert + refreshTeams', async () => {
    asAdmin()
    const r = await addTeam(' 신팀 ')
    expect(r.ok).toBe(true)
    expect(db.inserted.teams[0]).toMatchObject({ code: '신팀', name: '신팀' })
    expect(db.inserted.minute_folders[0]).toMatchObject({ name: '신팀', parent_id: null, created_by: null })
    expect(refreshTeams).toHaveBeenCalled()
  })

  it('동명 시드 폴더가 이미 있으면 폴더 insert 는 생략하고 성공', async () => {
    asAdmin()
    db.folders = [{ id: 'f1', code: undefined, name: '신팀', parent_id: null, created_by: null }]
    const r = await addTeam('신팀')
    expect(r.ok).toBe(true)
    expect(db.inserted.minute_folders).toHaveLength(0)
  })

  it('updateTeam: 빈 patch 거부, 정상 patch 는 스네이크케이스로 update', async () => {
    asAdmin()
    expect((await updateTeam('t1', {})).ok).toBe(false)
    const r = await updateTeam('t1', { active: false, progressVisible: true, sortOrder: 3 })
    expect(r.ok).toBe(true)
    expect(db.updated[0]).toMatchObject({ id: 't1', patch: { active: false, progress_visible: true, sort_order: 3 } })
    expect(refreshTeams).toHaveBeenCalled()
  })
})
