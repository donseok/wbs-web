import { describe, it, expect, vi, beforeEach } from 'vitest'

// updateLevelSettings — 관리자 가드 → wbs_items 선행 조회(실패 시 중단) → 도메인 검증 → project_settings upsert.
// project_settings 는 쓰기 정책이 없어(0058) admin 클라이언트, wbs_items 조회는 server 클라이언트.
const { db, createServerClient, createAdminClient, requireProjectAdmin } = vi.hoisted(() => {
  const db = {
    wbsRows: [] as Array<{ id: string; parent_id: string | null }>,
    wbsSelectError: null as { message: string } | null,
    upserted: null as Record<string, unknown> | null,
    upsertError: null as { message: string } | null,
  }
  const createServerClient = vi.fn(async () => ({
    from: (table: string) => {
      if (table !== 'wbs_items') throw new Error(`예상치 못한 테이블(server client): ${table}`)
      return {
        select: () => ({
          eq: async () => (db.wbsSelectError
            ? { data: null, error: db.wbsSelectError }
            : { data: db.wbsRows, error: null }),
        }),
      }
    },
  }))
  const createAdminClient = vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'project_settings') throw new Error(`예상치 못한 테이블(admin client): ${table}`)
      return {
        upsert: async (row: Record<string, unknown>) => {
          if (db.upsertError) return { error: db.upsertError }
          db.upserted = row
          return { error: null }
        },
      }
    },
  }))
  const requireProjectAdmin = vi.fn()
  return { db, createServerClient, createAdminClient, requireProjectAdmin }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, requireSuperuser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { updateLevelSettings } from '@/app/actions/project'

const ADMIN = { ok: true as const, actor: { userId: 'u-admin', isSuperuser: false } }
const PID = 'proj-1'

beforeEach(() => {
  db.wbsRows = []
  db.wbsSelectError = null
  db.upserted = null
  db.upsertError = null
  requireProjectAdmin.mockReset()
  requireProjectAdmin.mockResolvedValue(ADMIN)
})

describe('updateLevelSettings', () => {
  it('관리자 가드 실패면 아무것도 쓰지 않는다', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    const r = await updateLevelSettings(PID, ['Phase', 'Task'])
    expect(r).toEqual({ ok: false, error: '권한이 없습니다.' })
    expect(db.upserted).toBeNull()
  })

  it('정상 입력이면 level_labels·max_depth(=길이)·updated_by 를 upsert 한다', async () => {
    db.wbsRows = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
    ]
    const r = await updateLevelSettings(PID, [' Phase ', 'System', 'WP', 'Task'])
    expect(r).toEqual({ ok: true })
    expect(db.upserted).toMatchObject({
      project_id: PID,
      level_labels: ['Phase', 'System', 'WP', 'Task'],
      max_depth: 4,
      updated_by: 'u-admin',
    })
  })

  it('기존 트리보다 얕게 줄이면 거부한다 — depth 2 트리에 2단', async () => {
    db.wbsRows = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
    ]
    const r = await updateLevelSettings(PID, ['Phase', 'Task'])
    expect(r.ok).toBe(false)
    expect(db.upserted).toBeNull()
  })

  it('wbs_items 선행 조회 실패면 중단한다 — 검증 불가를 통과로 위장하지 않는다', async () => {
    db.wbsSelectError = { message: 'connection lost' }
    const r = await updateLevelSettings(PID, ['Phase', 'Task', 'Activity'])
    expect(r.ok).toBe(false)
    expect(db.upserted).toBeNull()
  })

  it('빈 라벨 등 검증 실패는 도메인 에러 메시지를 그대로 돌려준다', async () => {
    const r = await updateLevelSettings(PID, ['Phase', '  '])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('2')
    expect(db.upserted).toBeNull()
  })

  it('upsert 실패는 에러로 보고한다', async () => {
    db.upsertError = { message: 'RLS 위반' }
    const r = await updateLevelSettings(PID, ['Phase', 'Task', 'Activity'])
    expect(r).toEqual({ ok: false, error: 'RLS 위반' })
  })
})
