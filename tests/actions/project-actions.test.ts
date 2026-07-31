import { describe, it, expect, vi, beforeEach } from 'vitest'

// createProject 의 project_settings pi 프리셋 시드(Task 11 finding I3)만 검증한다.
// projects insert 는 일반 클라이언트(su_insert_projects RLS 정책), project_settings insert 는
// 쓰기 정책이 없어(0058) admin 클라이언트가 필요하다 — 두 경로를 각각 모의한다.
const { db, createServerClient, createAdminClient, requireSuperuser } = vi.hoisted(() => {
  const db = {
    insertedProject: null as Record<string, unknown> | null,
    insertedSettings: null as Record<string, unknown> | null,
    projectInsertError: null as { message: string } | null,
    settingsInsertError: null as { message: string } | null,
    nextId: 1,
  }
  const createServerClient = vi.fn(async () => ({
    from: (table: string) => {
      if (table !== 'projects') throw new Error(`예상치 못한 테이블(server client): ${table}`)
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (db.projectInsertError) return { data: null, error: db.projectInsertError }
              db.insertedProject = row
              return { data: { id: `proj-${db.nextId++}` }, error: null }
            },
          }),
        }),
      }
    },
  }))
  const createAdminClient = vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'project_settings') throw new Error(`예상치 못한 테이블(admin client): ${table}`)
      return {
        insert: async (row: Record<string, unknown>) => {
          db.insertedSettings = row
          return { error: db.settingsInsertError }
        },
      }
    },
  }))
  const requireSuperuser = vi.fn()
  return { db, createServerClient, createAdminClient, requireSuperuser }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireSuperuser, requireProjectAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))

import { createProject } from '@/app/actions/project'

const SUPERUSER = { ok: true as const, actor: { userId: 'u-super', isSuperuser: true } }

beforeEach(() => {
  db.insertedProject = null
  db.insertedSettings = null
  db.projectInsertError = null
  db.settingsInsertError = null
  db.nextId = 1
  createServerClient.mockClear()
  createAdminClient.mockClear()
  requireSuperuser.mockReset()
  requireSuperuser.mockResolvedValue(SUPERUSER)
})

describe('createProject — project_settings pi 프리셋 시드 (Task 11 I3)', () => {
  it('성공 시 project_settings 에 pi 프리셋 값 + preset_applied:"pi" 를 insert 한다', async () => {
    await createProject('신규 프로젝트', '2026-01-01', '2026-12-31', '설명')

    expect(db.insertedProject).toMatchObject({ name: '신규 프로젝트', start_date: '2026-01-01', end_date: '2026-12-31' })
    expect(createAdminClient).toHaveBeenCalled()
    expect(db.insertedSettings).toMatchObject({
      project_id: 'proj-1',
      level_labels: ['Phase', 'Task', 'Activity'],
      max_depth: 3,
      extra_axis_label: 'Biz',
      preset_applied: 'pi',
    })
    expect((db.insertedSettings as { milestone_keywords: string[] }).milestone_keywords.length).toBeGreaterThan(0)
  })

  it('project_settings insert 실패는 프로젝트 생성 성공을 막지 않는다(로깅만 — 이력 기록 실패 관례)', async () => {
    db.settingsInsertError = { message: 'RLS 위반' }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(createProject('신규 프로젝트2', null, null, null)).resolves.toBeUndefined()

    expect(db.insertedProject).toMatchObject({ name: '신규 프로젝트2' })
    expect(errSpy).toHaveBeenCalledWith('[createProject] project_settings 시드 실패:', 'RLS 위반')
    errSpy.mockRestore()
  })
})
