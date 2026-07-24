import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const getMembership = vi.fn()
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
  getMembership: (...a: unknown[]) => getMembership(...(a as [])),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: vi.fn() }))
vi.mock('@/lib/ai/minutes-insights', () => ({ ensureMinuteInsights: vi.fn(), generateMinuteInsights: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn() }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(), getMinutesPage: vi.fn(), searchMinutes: vi.fn(),
  getMinuteFavorites: vi.fn(), getMinutesExplorer: vi.fn(),
}))

// 테이블별 결과를 주입하는 thenable 가짜 빌더 — insert/update/delete/select 체인 지원
type TableResult = { data?: unknown; error: { message: string; code?: string } | null }
function fakeClient(results: Record<string, TableResult>) {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const result = results[table] ?? { data: [], error: null }
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
      builder[m] = vi.fn((...a: unknown[]) => { log.push({ method: m, args: a }); return builder })
    }
    ;(builder as { then: (r: (v: TableResult) => void) => void }).then = resolve => resolve(result)
    return builder
  })
  return { client: { from }, calls, from }
}
const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import {
  createMinuteFolder, deleteMinuteFolder, moveMinuteToFolder, renameMinuteFolder, updateMinuteMeta,
} from '@/app/actions/minutes'

const seedFolders = [
  { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
  { id: 'f2', name: '하위', parent_id: 'f1', sort: 100, created_by: 'u1' },
]

beforeEach(() => {
  getSession.mockReset(); createServerClient.mockReset(); getMembership.mockReset()
  getSession.mockResolvedValue({ id: 'u1' })
  // 이 파일의 기존 케이스들은 멤버십 가드를 겨냥하지 않으므로 통과 기본값을 깔아준다 —
  // 개별 케이스(멤버십 null)만 아래서 오버라이드.
  getMembership.mockResolvedValue({ role: 'member' })
})

describe('createMinuteFolder', () => {
  it('미로그인은 실패 + 클라이언트 미생성', async () => {
    getSession.mockResolvedValue(null)
    const r = await createMinuteFolder('새폴더', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('멤버십 없음(세션은 존재)은 실패 + DB insert 미도달', async () => {
    getMembership.mockResolvedValue(null)
    const r = await createMinuteFolder('새폴더', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('이름 검증 실패(공백)는 DB 접근 없이 에러', async () => {
    const r = await createMinuteFolder('   ', null)
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('깊이 5단 초과는 거부', async () => {
    const chain = [
      { id: 'd1', name: '1', parent_id: null, sort: 0, created_by: null },
      { id: 'd2', name: '2', parent_id: 'd1', sort: 0, created_by: null },
      { id: 'd3', name: '3', parent_id: 'd2', sort: 0, created_by: null },
      { id: 'd4', name: '4', parent_id: 'd3', sort: 0, created_by: null },
      { id: 'd5', name: '5', parent_id: 'd4', sort: 0, created_by: null },
    ]
    const { client } = fakeClient({ minute_folders: { data: chain, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('6단', 'd5')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
  })
  it('유니크 위반(23505)은 중복 안내 문구로 매핑', async () => {
    const { client, from } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    // 두 번째 from('minute_folders') 호출(insert)만 에러를 내도록 교체
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: seedFolders, error: null }
        : { data: null, error: { message: 'duplicate key value', code: '23505' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    // 'PMO' 등 팀코드는 예약어 가드에 먼저 걸리므로 일반 이름으로 중복 경로를 겨냥한다(0043)
    const r = await createMinuteFolder('주간회의', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
  })
  it('루트에 팀코드 동명(ERP)은 예약어로 거부 — DB 접근 없이 (스쿼팅 차단, 0043)', async () => {
    const r = await createMinuteFolder('ERP', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 기본 폴더명')
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('하위 레벨의 팀코드 동명은 허용 — 루트 예약어만 차단', async () => {
    const { client } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('ERP', 'f1')
    expect(r.ok).toBe(true)
  })
  it('상위 폴더 FK 위반(23503)은 삭제 안내 문구로 매핑', async () => {
    const { client, from } = fakeClient({ minute_folders: { data: seedFolders, error: null } })
    // 두 번째 from('minute_folders') 호출(insert)만 에러를 내도록 교체
    let call = 0
    from.mockImplementation(() => {
      call += 1
      const result = call === 1
        ? { data: seedFolders, error: null }
        : { data: null, error: { message: 'insert or update on table violates foreign key constraint', code: '23503' } }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'maybeSingle', 'single']) {
        builder[m] = vi.fn(() => builder)
      }
      ;(builder as { then: (r: (v: typeof result) => void) => void }).then = resolve => resolve(result)
      return builder
    })
    createServerClient.mockResolvedValue(client)
    const r = await createMinuteFolder('새폴더', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('삭제')
  })
})

describe('renameMinuteFolder / deleteMinuteFolder', () => {
  it('rename: 이름 검증 실패는 DB 접근 없이 에러', async () => {
    const r = await renameMinuteFolder('f2', '')
    expect(r.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('rename: 0행 갱신(권한 없음/미존재)은 실패로 판정', async () => {
    const { client } = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('f1', '새이름')
    expect(r.ok).toBe(false)
  })
  it('delete: 0행 삭제는 실패, 1행 삭제는 성공', async () => {
    // 루트+created_by null 은 새 계약(팀 마스터)에서 팀 시드로 보호되므로 사용자 소유로 명시
    const { client } = fakeClient({ minute_folders: { data: [{ id: 'f2', parent_id: 'f1', created_by: 'u1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    expect((await deleteMinuteFolder('f2')).ok).toBe(true)
    const empty = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(empty.client)
    expect((await deleteMinuteFolder('f2')).ok).toBe(false)
  })
  it('rename: 시드 팀 루트(MES)는 개명 금지 — 자동 편철 앵커 보호(0043)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mes', name: 'MES', parent_id: null, sort: 2, created_by: null }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('f-mes', '엠이에스')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 기본 폴더')
  })
  it('rename/delete: 시드 하위 구분(구매)도 금지 — 이름 매칭 편철 앵커(리뷰 반영)', async () => {
    const seedTree = [
      { id: 'r-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null },
      { id: 'c-buy', name: '구매', parent_id: 'r-erp', sort: 1, created_by: null },
    ]
    const { client } = fakeClient({ minute_folders: { data: seedTree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('c-buy', '구매관리')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 기본 폴더')
    const d = await deleteMinuteFolder('c-buy')
    expect(d.ok).toBe(false)
    expect(d.error).toContain('삭제할 수 없습니다')
  })
  it('rename: 일반 루트를 팀코드 동명(MDM)으로 바꾸는 것도 거부(앵커 사칭 방지)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mine', name: '내폴더', parent_id: null, sort: 100, created_by: 'u1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await renameMinuteFolder('f-mine', 'MDM')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 기본 폴더명')
  })
  it('rename: 사용자 폴더의 일반 개명은 허용', async () => {
    const { client } = fakeClient({
      minute_folders: { data: [{ id: 'f-mine', name: '내폴더', parent_id: null, sort: 100, created_by: 'u1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    expect((await renameMinuteFolder('f-mine', '새이름')).ok).toBe(true)
  })
  it('delete: 시드 팀 루트(ERP)는 삭제 금지 — cascade 소실 방지(0043)', async () => {
    const { client, calls } = fakeClient({
      minute_folders: { data: [{ id: 'f-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('f-erp')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('삭제할 수 없습니다')
    expect(calls['minute_folders']!.some(c => c.method === 'delete')).toBe(false)
  })
  it('rename/delete: 가드 선행조회 실패는 중단(쓰기 선행조회 원칙)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: null, error: { message: 'db down' } },
    })
    createServerClient.mockResolvedValue(client)
    expect((await renameMinuteFolder('f1', '새이름')).ok).toBe(false)
    expect((await deleteMinuteFolder('f1')).ok).toBe(false)
  })
})

describe('updateMinuteMeta 폴더 이동(하위 구분, 수정 모달)', () => {
  const patch = { minuteDate: '2026-07-24', teamCode: 'MES' as const, title: '제목', meetingId: null }
  it('folderId 전달 시 folder_id 포함 갱신', async () => {
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1' }, error: null },
      minute_folders: { data: { id: 'c-log' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch, 'c-log')
    expect(r.ok).toBe(true)
    const upd = calls['minutes']!.find(c => c.method === 'update')!
    expect((upd.args[0] as Record<string, unknown>).folder_id).toBe('c-log')
  })
  it('folderId 미전달이면 folder_id 무접촉 — 수동 편철 존중', async () => {
    const { client, calls } = fakeClient({ minutes: { data: { created_by: 'u1' }, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch)
    expect(r.ok).toBe(true)
    const upd = calls['minutes']!.find(c => c.method === 'update')!
    expect('folder_id' in (upd.args[0] as Record<string, unknown>)).toBe(false)
  })
  it('전달된 폴더 미존재는 거부 — 갱신 미도달', async () => {
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1' }, error: null },
      minute_folders: { data: null, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch, 'ghost')
    expect(r.ok).toBe(false)
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
  })
})

describe('moveMinuteToFolder', () => {
  it('대상 폴더 미존재면 거부', async () => {
    const { client } = fakeClient({ minute_folders: { data: null, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'ghost')
    expect(r.ok).toBe(false)
  })
  it('folderId null(미분류)은 폴더 존재 검증 없이 진행, 0행 갱신은 권한 없음', async () => {
    const { client, calls } = fakeClient({ minutes: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', null)
    expect(r.ok).toBe(false)                       // 0행 → 권한 없음
    expect(calls['minute_folders']).toBeUndefined() // 폴더 조회 안 함
  })
  it('1행 갱신이면 성공', async () => {
    const { client } = fakeClient({
      minute_folders: { data: { id: 'f1' }, error: null },
      minutes: { data: [{ id: 'm1' }], error: null },
    })
    createServerClient.mockResolvedValue(client)
    expect((await moveMinuteToFolder('m1', 'f1')).ok).toBe(true)
  })
})
