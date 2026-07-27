import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn()
const getMembership = vi.fn()
const adminMocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  getSession: (...a: unknown[]) => getSession(...(a as [])),
  getMembership: (...a: unknown[]) => getMembership(...(a as [])),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: adminMocks.createAdminClient,
}))
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

function fakeMetadataAdmin(
  data: {
    old_project_id: string | null
    new_project_id: string | null
    wiki_rebuild_required: boolean
  } = {
    old_project_id: null,
    new_project_id: null,
    wiki_rebuild_required: false,
  },
) {
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    void fn
    void args
    const result: TableResult = { data, error: null }
    const builder: Record<string, unknown> = {
      single: vi.fn(() => builder),
    }
    ;(builder as { then: (resolve: (value: TableResult) => void) => void }).then =
      resolve => resolve(result)
    return builder
  })
  return { client: { rpc, from: vi.fn() }, rpc }
}

const createServerClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: (...a: unknown[]) => createServerClient(...(a as [])),
}))

import {
  clearMinuteExternalId, createMinuteFolder, deleteMinuteFolder, moveMinuteFolder,
  moveMinuteToFolder, renameMinuteFolder, updateMinuteMeta,
} from '@/app/actions/minutes'

const seedFolders = [
  { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
  { id: 'f2', name: '하위', parent_id: 'f1', sort: 100, created_by: 'u1' },
]

beforeEach(() => {
  getSession.mockReset(); createServerClient.mockReset(); getMembership.mockReset()
  adminMocks.createAdminClient.mockReset()
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
    // 루트 생성은 W18로 막히므로 팀 폴더 하위에서 중복 경로를 겨냥한다
    const r = await createMinuteFolder('주간회의', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
  })
  it('W18: 루트 폴더 생성은 이름과 무관하게 거부 — DB 접근 없이 (§6.3 불변식)', async () => {
    // 사용자 루트 폴더가 하나라도 생기면 그 서브트리 회의록의 team 파생이 끊긴다
    for (const name of ['ERP', '주간회의']) {
      const r = await createMinuteFolder(name, null)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('담당 팀 폴더 안에만')
    }
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
    const { client: admin } = fakeClient({
      minute_folders: { data: [], error: null }, minutes: { data: [], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await deleteMinuteFolder('f2')).ok).toBe(true)
    const empty = fakeClient({ minute_folders: { data: [], error: null } })
    createServerClient.mockResolvedValue(empty.client)
    expect((await deleteMinuteFolder('f2')).ok).toBe(false)   // 폴더 목록에 없음
  })

  it('delete: 비우기 우선 — 하위 폴더·소속 회의록을 부모로 승격한 뒤 지운다(§6)', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
      { id: 'f2', name: '대상', parent_id: 'f1', sort: 100, created_by: 'u1' },
      { id: 'f3', name: '자식', parent_id: 'f2', sort: 100, created_by: 'u9' },
    ]
    const { client } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const { client: admin, calls: adminCalls } = fakeClient({
      minute_folders: { data: [{ id: 'f3' }], error: null }, minutes: { data: [{ id: 'm1' }], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await deleteMinuteFolder('f2')).ok).toBe(true)
    // 자식 폴더 승격
    const folderUpd = adminCalls['minute_folders']!.find(c => c.method === 'update')!
    expect(folderUpd.args[0]).toMatchObject({ parent_id: 'f1' })
    // 회의록 승격 — updated_at 은 건드리지 않는다(조직 정리가 '방금 수정됨'으로 비치면 안 됨)
    const minuteUpd = adminCalls['minutes']!.find(c => c.method === 'update')!
    expect(minuteUpd.args[0]).toEqual({ folder_id: 'f1' })
  })

  it('delete: 승격 시 상위에 동명이 있으면 중단 — cascade 로 조용히 지우지 않는다', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
      { id: 'f2', name: '대상', parent_id: 'f1', sort: 100, created_by: 'u1' },
      { id: 'f3', name: '겹침', parent_id: 'f2', sort: 100, created_by: 'u1' },
      { id: 'f4', name: '겹침', parent_id: 'f1', sort: 100, created_by: 'u1' },
    ]
    const { client, calls } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('f2')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('겹침')
    expect(calls['minute_folders']!.some(c => c.method === 'delete')).toBe(false)
  })

  it('delete: 작성자도 pmo_admin 도 아니면 승격 전에 거절', async () => {
    const tree = [
      { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
      { id: 'f2', name: '남의폴더', parent_id: 'f1', sort: 100, created_by: 'other' },
    ]
    const { client } = fakeClient({ minute_folders: { data: tree, error: null } })
    createServerClient.mockResolvedValue(client)
    const r = await deleteMinuteFolder('f2')
    expect(r.ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
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
  it('rename/delete: 시드 하위 구분(구매)은 허용 — 하위 구분이 실폴더 동적 유도로 바뀌어 앵커 보호 해제', async () => {
    const seedTree = [
      { id: 'r-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null },
      { id: 'c-buy', name: '구매', parent_id: 'r-erp', sort: 1, created_by: null },
    ]
    const { client } = fakeClient({ minute_folders: { data: seedTree, error: null } })
    createServerClient.mockResolvedValue(client)
    // fakeClient 는 갱신·삭제 결과로 테이블 데이터를 그대로 돌려주므로(비어있지 않음) 성공 경로에 도달
    const r = await renameMinuteFolder('c-buy', '구매관리')
    expect(r.ok).toBe(true)
    // 삭제는 '비우기 우선'이라 admin 으로 승격 후 지운다. created_by null 이라 pmo_admin 이어야 한다.
    getMembership.mockResolvedValue({ role: 'pmo_admin' })
    const { client: admin } = fakeClient({
      minute_folders: { data: [], error: null }, minutes: { data: [], error: null },
    })
    adminMocks.createAdminClient.mockReturnValue(admin)
    const d = await deleteMinuteFolder('c-buy')
    expect(d.ok).toBe(true)
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
  it('folderId 전달 시 folder_id 포함 갱신 + team_code 를 폴더에서 파생(클라이언트 값 불신)', async () => {
    const tree = [
      { id: 'r-erp', name: 'ERP', parent_id: null, sort: 1, created_by: null },
      { id: 'c-log', name: '물류', parent_id: 'r-erp', sort: 1, created_by: 'u1' },
    ]
    const { client } = fakeClient({
      minutes: { data: { created_by: 'u1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin()
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    // patch.teamCode 는 'MES' 인데 폴더는 ERP 서브트리다 — 서버가 폴더를 이긴다
    const r = await updateMinuteMeta('m1', { ...patch, teamCode: 'MES' }, 'c-log')
    expect(r.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({
        p_minute_id: 'm1',
        p_metadata: expect.objectContaining({ folder_id: 'c-log', team_code: 'ERP' }),
      }),
    )
  })

  it('시드 체인 밖 폴더는 거절 — 팀을 추측하지 않는다(§6.3 서버 강제)', async () => {
    const tree = [{ id: 'orphan', name: '떠돌이', parent_id: null, sort: 100, created_by: 'u1' }]
    const { client, calls } = fakeClient({
      minutes: { data: { created_by: 'u1' }, error: null },
      minute_folders: { data: tree, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await updateMinuteMeta('m1', patch, 'orphan')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('담당 팀을 판정할 수 없는')
    expect(calls['minutes']!.some(c => c.method === 'update')).toBe(false)
  })
  it('folderId 미전달이면 folder_id 무접촉 — 수동 편철 존중', async () => {
    const { client } = fakeClient({ minutes: { data: { created_by: 'u1' }, error: null } })
    const { client: admin, rpc } = fakeMetadataAdmin()
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    const r = await updateMinuteMeta('m1', patch)
    expect(r.ok).toBe(true)
    const args = rpc.mock.calls[0][1]
    expect('folder_id' in (args.p_metadata as Record<string, unknown>)).toBe(false)
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
  it('같은 팀 안 이동은 1행 갱신으로 성공 — raw update(위키 무영향)', async () => {
    const { client } = fakeClient({
      minute_folders: { data: seedFolders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO' }, error: null },
    })
    const { client: admin } = fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await moveMinuteToFolder('m1', 'f2')).ok).toBe(true)
    // 같은 팀(PMO)이라 메타 RPC 를 타지 않는다
    expect(adminMocks.createAdminClient).toHaveBeenCalled()
  })

  it('§6.4 팀을 넘어가면 team_code 를 동반 갱신하고 메타 RPC 를 경유한다', async () => {
    const folders = [
      ...seedFolders,
      { id: 'f3', name: 'MES', parent_id: null, sort: 2, created_by: null },
      { id: 'f4', name: '품질', parent_id: 'f3', sort: 100, created_by: 'u1' },
    ]
    const { client } = fakeClient({
      minute_folders: { data: folders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO' }, error: null },
    })
    const { client: admin, rpc } = fakeMetadataAdmin({
      old_project_id: null, new_project_id: null, wiki_rebuild_required: false,
    })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await moveMinuteToFolder('m1', 'f4')).ok).toBe(true)
    // raw update 로 하면 ai_documents 가 옛 team_code 로 남는다
    expect(rpc).toHaveBeenCalledWith(
      'update_minute_metadata_with_wiki_retraction',
      expect.objectContaining({
        p_minute_id: 'm1',
        p_metadata: expect.objectContaining({ team_code: 'MES', folder_id: 'f4' }),
      }),
    )
  })

  it('시드 체인 밖 폴더로는 이동을 거절한다 — 팀을 추측하지 않는다', async () => {
    const folders = [
      ...seedFolders,
      { id: 'f9', name: '떠돌이', parent_id: null, sort: 100, created_by: 'u1' },
    ]
    const { client } = fakeClient({
      minute_folders: { data: folders, error: null },
      minutes: { data: { id: 'm1', created_by: 'u1', team_code: 'PMO' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await moveMinuteToFolder('m1', 'f9')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('담당 팀을 판정할 수 없는')
  })
})

/* ── W21 폴더 이동 (§6.5) ──────────────────────────────────────────────────── */

describe('moveMinuteFolder (W21 — pmo_admin 전용, 가드 M1~M5)', () => {
  /** PMO(f1) / 하위(f2) / 하위-깊이2(f5) · MES(f3) / 품질(f4) */
  const tree = [
    { id: 'f1', name: 'PMO', parent_id: null, sort: 0, created_by: null },
    { id: 'f2', name: '하위', parent_id: 'f1', sort: 100, created_by: 'u1' },
    { id: 'f5', name: '더하위', parent_id: 'f2', sort: 100, created_by: 'u1' },
    { id: 'f3', name: 'MES', parent_id: null, sort: 2, created_by: null },
    { id: 'f4', name: '품질', parent_id: 'f3', sort: 100, created_by: 'u1' },
  ]
  const admin = () => {
    getMembership.mockResolvedValue({ role: 'pmo_admin' })
  }
  const withTree = (folders = tree) => {
    const fake = fakeClient({ minute_folders: { data: folders, error: null } })
    createServerClient.mockResolvedValue(fake.client)
    return fake
  }

  it('일반 사용자는 거부 — DB 접근 전에 막는다', async () => {
    const r = await moveMinuteFolder('f2', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('관리자')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('미로그인은 거부', async () => {
    getSession.mockResolvedValue(null)
    expect((await moveMinuteFolder('f2', 'f1')).ok).toBe(false)
  })

  it('M2 — 루트로 이동 금지(DB 접근 전)', async () => {
    admin()
    const r = await moveMinuteFolder('f2', null)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('담당 팀 폴더 안에만')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('M3 — 자기 자신 아래로 이동 금지(DB 접근 전)', async () => {
    admin()
    expect((await moveMinuteFolder('f2', 'f2')).ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('M1 — 시드 팀 루트는 이동 불가', async () => {
    admin(); const { calls } = withTree()
    const r = await moveMinuteFolder('f1', 'f3')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('팀 기본 폴더')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  it('M3 — 자손 아래로 이동 금지(f2 → f5)', async () => {
    admin(); const { calls } = withTree()
    const r = await moveMinuteFolder('f2', 'f5')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('하위 폴더')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  it('M4 — 서브트리 높이까지 더해 깊이 5를 넘으면 거부', async () => {
    admin()
    // A(1)/B(2)/C(3) 아래로, 높이 3짜리 X(1)/Y(2)/Z(3) 를 옮기면 3+3=6 > 5
    const deep = [
      { id: 'a', name: 'PMO', parent_id: null, sort: 0, created_by: null },
      { id: 'b', name: 'B', parent_id: 'a', sort: 100, created_by: 'u1' },
      { id: 'c', name: 'C', parent_id: 'b', sort: 100, created_by: 'u1' },
      { id: 'x', name: 'X', parent_id: 'a', sort: 100, created_by: 'u1' },
      { id: 'y', name: 'Y', parent_id: 'x', sort: 100, created_by: 'u1' },
      { id: 'z', name: 'Z', parent_id: 'y', sort: 100, created_by: 'u1' },
    ]
    const { calls } = withTree(deep)
    const r = await moveMinuteFolder('x', 'c')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5단')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  it('M5 — 같은 부모에 동명 폴더가 있으면 거부(23505 원문 노출 아님)', async () => {
    admin()
    const dup = [
      ...tree,
      { id: 'f6', name: '품질', parent_id: 'f1', sort: 100, created_by: 'u1' },
    ]
    const { calls } = withTree(dup)
    const r = await moveMinuteFolder('f4', 'f1')   // 팀 간 이동이라 그 가드가 먼저 걸린다
    expect(r.ok).toBe(false)
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  it('같은 팀 안 동명 중복은 M5 로 거부', async () => {
    admin()
    const dup = [
      ...tree,
      { id: 'f7', name: '보고', parent_id: 'f1', sort: 100, created_by: 'u1' },
      { id: 'f8', name: '보고', parent_id: 'f2', sort: 100, created_by: 'u1' },
    ]
    const { calls } = withTree(dup)
    const r = await moveMinuteFolder('f8', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('이미')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  it('팀 간 이동은 v1 에서 차단 — 회의록 개별 이동으로 안내', async () => {
    admin(); const { calls } = withTree()
    const r = await moveMinuteFolder('f2', 'f3')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('다른 담당 팀')
    expect(calls['minute_folders']!.some(c => c.method === 'update')).toBe(false)
  })

  /** 1회차 = loadFolders(트리), 2회차 = update 결과. 호출 순서로 결과를 가르는 이 파일 관례. */
  function seqClient(updateRows: unknown) {
    const args: unknown[][] = []
    let n = 0
    const from = vi.fn(() => {
      n += 1
      const result: TableResult = n === 1
        ? { data: tree, error: null }
        : { data: updateRows, error: null }
      const builder: Record<string, unknown> = {}
      for (const mth of ['select', 'eq']) builder[mth] = vi.fn(() => builder)
      builder.update = vi.fn((a: unknown) => { args.push([a]); return builder })
      ;(builder as { then: (r: (v: TableResult) => void) => void }).then = r => r(result)
      return builder
    })
    createServerClient.mockResolvedValue({ from })
    return { updateArgs: args }
  }

  it('같은 팀 안 이동은 성공하고 부모·sort·updated_at 을 갱신한다', async () => {
    admin()
    const { updateArgs } = seqClient([{ id: 'f5' }])
    const r = await moveMinuteFolder('f5', 'f1')   // PMO/하위/더하위 → PMO/더하위
    expect(r.ok).toBe(true)
    expect(updateArgs[0][0]).toMatchObject({ parent_id: 'f1', sort: 100 })
    expect(updateArgs[0][0]).toHaveProperty('updated_at')
  })

  it('RLS 0행은 조용한 no-op 이 아니라 실패로 보고한다', async () => {
    admin()
    seqClient([])
    const r = await moveMinuteFolder('f5', 'f1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('권한')
  })
})

/* ── W10 연결 초기화 (§9.4) ────────────────────────────────────────────────── */

describe('clearMinuteExternalId (W10 — 연결 초기화)', () => {
  it('미로그인은 거부', async () => {
    getSession.mockResolvedValue(null)
    expect((await clearMinuteExternalId('m1')).ok).toBe(false)
  })

  it('external_id 를 null 로 갱신하고 updated_at 은 갱신한다(사용자 조작)', async () => {
    const { client } = fakeClient({ minutes: { data: { id: 'm1', created_by: 'u1' }, error: null } })
    const { client: admin, calls } = fakeClient({ minutes: { data: [{ id: 'm1' }], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await clearMinuteExternalId('m1')).ok).toBe(true)
    const upd = calls['minutes']!.find(c => c.method === 'update')!
    expect(upd.args[0]).toMatchObject({ external_id: null })
    expect(upd.args[0]).toHaveProperty('updated_at')
  })

  it('보관된 회의록은 초기화 불가 — 재연결이 막힌 편도 상태를 만들지 않는다', async () => {
    const { client } = fakeClient({
      minutes: { data: { id: 'm1', created_by: 'u1', archived_at: '2026-07-20' }, error: null },
    })
    createServerClient.mockResolvedValue(client)
    const r = await clearMinuteExternalId('m1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('보관된')
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('작성자도 pmo_admin 도 아니면 거부', async () => {
    const { client } = fakeClient({ minutes: { data: { id: 'm1', created_by: 'other' }, error: null } })
    createServerClient.mockResolvedValue(client)
    expect((await clearMinuteExternalId('m1')).ok).toBe(false)
    expect(adminMocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('0행 갱신은 실패로 보고한다', async () => {
    const { client } = fakeClient({ minutes: { data: { id: 'm1', created_by: 'u1' }, error: null } })
    const { client: admin } = fakeClient({ minutes: { data: [], error: null } })
    createServerClient.mockResolvedValue(client)
    adminMocks.createAdminClient.mockReturnValue(admin)
    expect((await clearMinuteExternalId('m1')).ok).toBe(false)
  })
})
