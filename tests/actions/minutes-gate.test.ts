import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에 DB 클라이언트가 만들어지면 즉시 실패시킨다.
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('createServerClient 는 게이트 통과 전에 호출되면 안 된다')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getMembership, getSession } from '@/lib/auth'
import { createMinutes, deleteMinutes } from '@/app/actions/minutes'

const FILE = { fileName: 'a.md', filePath: 'p1/t-erp/1-a.md', size: 10, mime: 'text/markdown' }
const INPUT = { teamId: 't-erp', minutesDate: '2026-07-08', title: '킥오프', contentMd: '# hi' }
const PMO = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't-pmo' } as const
/** 유효 세션. 게이트가 없으면 실행이 createServerClient 까지 도달하도록 만드는 역할. */
const USER = { id: 'u1', email: 'a@b.com', user_metadata: { full_name: '홍길동' } }

describe('회의록 서버액션 권한 게이트', () => {
  // getMembership/getSession 을 리셋하지 않으면 모킹이 테스트 간에 새어, 뒤 테스트가
  // 의도한 게이트가 아니라 앞 테스트가 남긴 세션 때문에 통과한다.
  // createServerClient 는 mockClear 만 한다 — mockReset 은 throw 구현까지 지운다.
  beforeEach(() => {
    vi.mocked(getMembership).mockReset()
    vi.mocked(getSession).mockReset()
    createServerClient.mockClear()
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
})
