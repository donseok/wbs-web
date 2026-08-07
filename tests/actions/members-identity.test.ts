import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerClient, requireProjectAdmin, resolveProjectId, revalidatePath } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { addMember, updateMember, type MemberInput } from '@/app/actions/members'

const PROJECT_ID = 'project-1'
const MEMBER_ID = 'member-1'
const CONFLICT_ERROR = '동일한 이메일은 모든 프로젝트에서 같은 이름으로 등록해야 합니다.'
const INPUT: MemberInput = {
  name: '홍길동',
  email: 'hong@company.com',
  teamCode: null,
  role: 'contributor',
  title: null,
}

interface ClientOptions {
  identityRows?: { id: string; name: string }[]
  identityError?: { message: string } | null
  writeError?: { code?: string; message: string } | null
  rpcError?: { code?: string; message: string } | null
}

function makeClient(options: ClientOptions = {}) {
  const insert = vi.fn(async () => ({ error: options.writeError ?? null }))
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: options.writeError ? null : { project_id: PROJECT_ID },
          error: options.writeError ?? null,
        })),
      })),
    })),
  }))
  const identity = {
    order: vi.fn(),
    limit: vi.fn(async () => ({
      data: options.identityRows ?? [],
      error: options.identityError ?? null,
    })),
  }
  identity.order.mockReturnValue(identity)

  const identityEq = vi.fn(() => identity)
  const identitySelect = vi.fn(() => ({ eq: identityEq }))
  const rpc = vi.fn(async () => ({ data: options.rpcError ? null : true, error: options.rpcError ?? null }))
  const from = vi.fn((table: string) => {
    if (table !== 'project_members') throw new Error('예상치 못한 테이블: ' + table)
    return { select: identitySelect, insert, update }
  })
  createServerClient.mockResolvedValue({ from, rpc } as never)
  return { from, insert, update, rpc, identity, identityEq, identitySelect }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
  resolveProjectId.mockResolvedValue({ ok: true, projectId: PROJECT_ID })
})

describe('멤버 이메일 전역 이름 정합성', () => {
  it('같은 이메일의 다른 프로젝트 이름이 다르면 추가를 거부한다', async () => {
    const db = makeClient({ identityRows: [{ id: 'other', name: '김철수' }] })

    expect(await addMember(PROJECT_ID, {
      ...INPUT,
      email: '  HONG@Company.com ',
    })).toEqual({ ok: false, error: CONFLICT_ERROR })

    expect(db.identityEq).toHaveBeenCalledWith('email', 'hong@company.com')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('같은 이메일과 같은 이름은 다른 프로젝트에도 등록할 수 있다', async () => {
    const db = makeClient({ identityRows: [{ id: 'other', name: '홍길동' }] })

    expect(await addMember(PROJECT_ID, {
      ...INPUT,
      name: '  홍길동  ',
      email: ' HONG@Company.com ',
    })).toEqual({ ok: true })

    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
      project_id: PROJECT_ID,
      name: '홍길동',
      email: 'hong@company.com',
    }))
  })

  it('이메일 없는 외부 인력은 전역 정본 조회 없이 등록한다', async () => {
    const db = makeClient()

    expect(await addMember(PROJECT_ID, { ...INPUT, email: null })).toEqual({ ok: true })

    expect(db.identitySelect).not.toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ email: null }))
  })

  it('여러 프로젝트가 공유하는 이름 변경은 일반 관리자에게 친화 문구로 거부한다', async () => {
    const db = makeClient({
      rpcError: { code: '42501', message: 'PROJECT_MEMBER_IDENTITY_RENAME_FORBIDDEN' },
    })

    expect(await updateMember(MEMBER_ID, { ...INPUT, name: '홍길순' }))
      .toEqual({
        ok: false,
        error: '여러 프로젝트에서 사용하는 이름은 슈퍼유저만 변경할 수 있습니다.',
      })

    expect(db.rpc).toHaveBeenCalled()
  })

  it('동시 수정으로 상태가 바뀌면 재시도 안내를 보여준다', async () => {
    makeClient({
      rpcError: { code: '40001', message: 'PROJECT_MEMBER_RETRY' },
    })

    expect(await updateMember(MEMBER_ID, INPUT)).toEqual({
      ok: false,
      error: '다른 요청이 멤버 정보를 변경했습니다. 다시 시도해 주세요.',
    })
  })

  it('이름 교정과 프로젝트 속성을 원자 RPC 한 번으로 수정한다', async () => {
    const db = makeClient()

    expect(await updateMember(MEMBER_ID, {
      ...INPUT,
      name: ' 홍길순 ',
      email: ' HONG@Company.com ',
      title: 'PM',
    })).toEqual({ ok: true })

    expect(db.rpc).toHaveBeenCalledWith('update_project_member_with_identity', {
      p_member_id: MEMBER_ID,
      p_name: '홍길순',
      p_email: 'hong@company.com',
      p_team_id: null,
      p_role: 'contributor',
      p_title: 'PM',
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${PROJECT_ID}/members`)
  })

  it('RPC 안의 새 email 정본 충돌도 같은 일반화 문구로 바꾼다', async () => {
    makeClient({
      rpcError: { code: '23514', message: 'PROJECT_MEMBER_EMAIL_NAME_MISMATCH' },
    })

    expect(await updateMember(MEMBER_ID, { ...INPUT, email: 'other@company.com' }))
      .toEqual({ ok: false, error: CONFLICT_ERROR })
  })

  it('전역 기준정보 조회가 실패하면 멤버가 없다고 간주하지 않고 중단한다', async () => {
    const db = makeClient({ identityError: { message: 'db unavailable' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await addMember(PROJECT_ID, INPUT)).toEqual({
      ok: false,
      error: '멤버 기준정보를 확인할 수 없어 중단했습니다.',
    })

    spy.mockRestore()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('사전 조회 뒤 동시 쓰기 충돌도 DB marker를 친화 문구로 바꾼다', async () => {
    makeClient({
      identityRows: [],
      writeError: { code: '23514', message: 'PROJECT_MEMBER_EMAIL_NAME_MISMATCH' },
    })

    expect(await addMember(PROJECT_ID, INPUT)).toEqual({ ok: false, error: CONFLICT_ERROR })
  })

  it('클라이언트를 우회한 빈 이름도 서버에서 거부한다', async () => {
    expect(await addMember(PROJECT_ID, { ...INPUT, name: '   ' })).toEqual({
      ok: false,
      error: '이름을 입력하세요.',
    })
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
