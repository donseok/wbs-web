import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에 DB 클라이언트가 만들어지면 즉시 실패시킨다.
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getMembership, getSession } from '@/lib/auth'
import { createMinutes, deleteMinutes } from '@/app/actions/minutes'

const FILE = { fileName: 'a.md', filePath: 'p1/t-erp/1-a.md', size: 10, mime: 'text/markdown' }
const INPUT = { teamId: 't-erp', minutesDate: '2026-07-08', title: '킥오프', contentMd: '# hi' }
const PMO = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't-pmo' } as const
const EDITOR = { role: 'team_editor', teamCode: 'ERP', teamId: 't-erp' } as const
/** 유효 세션. 게이트가 없으면 실행이 createServerClient 까지 도달하도록 만드는 역할. */
const USER = { id: 'u1', email: 'a@b.com', user_metadata: { full_name: '홍길동' } }

/** 기본 구현: 게이트를 통과하기 전에 불리면 터진다. 게이트 순서를 강제하는 장치다. */
const THROW_ON_DB = () => {
  throw new Error('createServerClient 는 게이트 통과 전에 호출되면 안 된다')
}

type ErrShape = { code?: string; message: string } | null
/**
 * 게이트 이후 경로를 검사하는 테스트만 opt-in 하는 비-throw 클라이언트.
 * 기본값(THROW_ON_DB)을 전역으로 약화시키지 않으려고 테스트별로 갈아 끼운다.
 */
function fakeClient(opts: {
  row?: Record<string, unknown> | null
  insertError?: ErrShape
  deleteError?: ErrShape
  removeError?: { message: string } | null
}) {
  // order: remove()/row-delete 의 상대 순서를 실행 순서 그대로 기록한다.
  // 스토리지 삭제 정책의 EXISTS 는 행이 살아 있어야 객체 삭제를 허가하므로,
  // 반드시 'remove' 가 'row-delete' 보다 먼저여야 한다(주석이 아니라 테스트로 고정).
  const calls = { removed: [] as string[][], rowDeleted: false, order: [] as string[] }
  const client = {
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: 'new-id' }, error: opts.insertError ?? null }) }),
      }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.row ?? null, error: null }) }) }),
      delete: () => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              calls.rowDeleted = true
              calls.order.push('row-delete')
              return { data: { id: 'm1' }, error: opts.deleteError ?? null }
            },
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          calls.removed.push(paths)
          calls.order.push('remove')
          return { data: [], error: opts.removeError ?? null }
        },
      }),
    },
  }
  return { client, calls }
}

/** 게이트 이후를 보는 테스트에서만 호출. */
function useClient(c: ReturnType<typeof fakeClient>['client']) {
  createServerClient.mockImplementation(() => c as never)
}

describe('회의록 서버액션 권한 게이트', () => {
  // getMembership/getSession 을 리셋하지 않으면 모킹이 테스트 간에 새어, 뒤 테스트가
  // 의도한 게이트가 아니라 앞 테스트가 남긴 세션 때문에 통과한다.
  // createServerClient 도 매번 throw 구현으로 되돌린다 — 한 테스트의 useClient() 가
  // 뒤 테스트의 게이트 강제 장치를 무력화하면 안 된다.
  beforeEach(() => {
    vi.mocked(getMembership).mockReset()
    vi.mocked(getSession).mockReset()
    createServerClient.mockReset()
    createServerClient.mockImplementation(THROW_ON_DB)
  })

  it('비로그인은 createMinutes 거부 — DB 접촉 없음', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    expect(await createMinutes('p1', INPUT, FILE)).toEqual({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('team_editor 는 남의 팀에 createMinutes 거부 — DB 접촉 없음', async () => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor', teamCode: 'ERP', teamId: 't-erp' })
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createMinutes('p1', { ...INPUT, teamId: 't-mes' }, FILE)
    expect(res).toEqual({ ok: false, error: '담당 팀이 아닙니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('검증 실패는 DB 접촉 전에 반려된다', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createMinutes('p1', { ...INPUT, title: '  ' }, FILE)
    expect(res).toEqual({ ok: false, error: '제목을 입력하세요.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('비-md 파일에 contentMd 를 채우면 반려된다 (DB 체크제약 선반영)', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createMinutes('p1', INPUT, { ...FILE, filePath: 'p1/t-erp/1-a.pdf', fileName: 'a.pdf' })
    expect(res).toEqual({ ok: false, error: '마크다운 파일이 아닌데 본문이 전달되었습니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('세션이 없으면 createMinutes 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect(await createMinutes('p1', INPUT, FILE)).toEqual({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('비로그인은 deleteMinutes 거부 — DB 접촉 없음', async () => {
    vi.mocked(getMembership).mockResolvedValue(null)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    expect(await deleteMinutes('m1')).toEqual({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // fileName 과 filePath 는 호출자가 각각 통제하는 별개 문자열이다. DB 의 minutes_md_only
  // 체크제약은 filePath 만 검사하므로, 판정도 filePath 로 해야 한다 — fileName 만 보면
  // fileName:'a.md' + filePath:'*.exe' 조합이 게이트를 통과해 insert 단계에서야 실패한다.
  // 세션을 유효하게 두었으므로, 이 가드가 없으면 실행은 createServerClient 까지 가서 throw 한다.
  it('fileName 이 .md 라도 filePath 가 아니면 반려된다 (판정 기준은 filePath)', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createMinutes('p1', INPUT, { ...FILE, filePath: 'p1/t-erp/1-evil.exe', fileName: 'a.md' })
    expect(res).toEqual({ ok: false, error: '마크다운 파일이 아닌데 본문이 전달되었습니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // filePath 는 Storage 객체 키로 그대로 쓰이고 행에 영구 저장된다. 스토리지 정책은 bucket_id 만
  // 검사하므로(0019 주석) 접두사를 강제하지 않으면 다른 프로젝트/팀 폴더를 가리키는 행을 기록할 수
  // 있고, 이후 deleteMinutes 가 그 객체를 지워버리는 크로스 테넌트 삭제로 이어진다.
  // 이 가드가 없으면 filePath 가 .md 라 md 가드도 통과해 createServerClient 까지 도달한다.
  it('filePath 가 프로젝트/팀 접두사를 벗어나면 반려된다 (크로스 테넌트 스토리지 키 방지)', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createMinutes('p1', INPUT, { ...FILE, filePath: 'other-project/t-erp/1-a.md' })
    expect(res).toEqual({ ok: false, error: '파일 경로가 올바르지 않습니다.' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('세션이 없으면 deleteMinutes 거부 — DB 접촉 없음', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect(await deleteMinutes('m1')).toEqual({ ok: false, error: '로그인 필요' })
    expect(createServerClient).not.toHaveBeenCalled()
  })

  // 작성자도 PMO 도 아니면 거부. 중요한 건 메시지가 아니라 부작용이 없다는 것 —
  // 객체를 지우지 않았고 행도 건드리지 않았다.
  it('작성자도 PMO 도 아니면 deleteMinutes 거부 — 객체·행 모두 보존', async () => {
    vi.mocked(getMembership).mockResolvedValue(EDITOR)
    vi.mocked(getSession).mockResolvedValue(USER as never) // id 'u1'
    const { client, calls } = fakeClient({
      row: { project_id: 'p1', file_path: 'p1/t-erp/1-a.md', created_by: 'someone-else' },
    })
    useClient(client)
    expect(await deleteMinutes('m1')).toEqual({ ok: false, error: '권한 없음' })
    expect(calls.removed).toEqual([])
    expect(calls.rowDeleted).toBe(false)
  })

  // 행 삭제가 0행이면 PGRST116. 객체는 이미 지워진 뒤이므로(순서가 필수) 재시도 안내를 준다.
  // remove() 가 행 삭제보다 먼저 불렸다는 것도 함께 못 박는다.
  it('행 삭제 0행(PGRST116)은 재시도 안내로 매핑 — 객체는 먼저 지워졌다', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const { client, calls } = fakeClient({
      row: { project_id: 'p1', file_path: 'p1/t-erp/1-a.md', created_by: 'u1' },
      deleteError: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' },
    })
    useClient(client)
    expect(await deleteMinutes('m1')).toEqual({
      ok: false,
      error: '회의록 기록을 삭제하지 못했습니다. 다시 시도해 주세요.',
    })
    expect(calls.removed).toEqual([['p1/t-erp/1-a.md']])
  })

  it('중복 file_path(23505)는 사용자 메시지로 매핑된다', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const { client } = fakeClient({
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint "minutes_file_path_key"' },
    })
    useClient(client)
    expect(await createMinutes('p1', INPUT, FILE)).toEqual({ ok: false, error: '이미 등록된 파일입니다.' })
  })

  it('그 밖의 insert 에러는 메시지를 그대로 전달한다', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const { client } = fakeClient({
      insertError: { code: '23503', message: 'insert or update on table violates foreign key constraint' },
    })
    useClient(client)
    expect(await createMinutes('p1', INPUT, FILE)).toEqual({
      ok: false,
      error: 'insert or update on table violates foreign key constraint',
    })
  })

  // insert 시 발생 가능한 나머지 SQLSTATE 를 사용자 메시지로 매핑한다(스키마 세부 노출 방지).
  it.each([
    ['23514', '입력 값이 올바르지 않습니다.', 'new row violates check constraint "minutes_title_len"'],
    ['42501', '권한이 없습니다.', 'new row violates row-level security policy for table "meeting_minutes"'],
    ['22P02', '잘못된 요청입니다.', 'invalid input syntax for type uuid: "not-a-uuid"'],
  ])('insert 에러 %s 는 사용자 메시지로 매핑된다', async (code, expected, raw) => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const { client } = fakeClient({ insertError: { code, message: raw } })
    useClient(client)
    expect(await createMinutes('p1', INPUT, FILE)).toEqual({ ok: false, error: expected })
  })

  // 삭제는 객체(remove) → 행(delete) 순서여야 한다. 이 순서가 뒤집히면 정책의 EXISTS 가 깨져
  // 프로덕션에서 고아 객체가 남지만, 순서만 주석인 한 테스트는 초록이다. 실행 순서로 못 박는다.
  it('deleteMinutes 는 객체를 행보다 먼저 지운다 (순서 불변식)', async () => {
    vi.mocked(getMembership).mockResolvedValue(PMO)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const { client, calls } = fakeClient({
      row: { project_id: 'p1', file_path: 'p1/t-erp/1-a.md', created_by: 'u1' },
    })
    useClient(client)
    expect(await deleteMinutes('m1')).toEqual({ ok: true })
    expect(calls.order).toEqual(['remove', 'row-delete'])
  })
})
