import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R4 게이트(결정 §2-A C-2) — 폴더 D&D 는 재편철 1회차 완료 후에 연다.
 *
 * UI 에서 draggable 을 끄는 것만으로는 서버 액션이 열려 있다. `moveMinuteFolder` 는
 * MinutesExplorer 의 드롭 핸들러가 **유일한 호출부**라(이동 모달은 `moveMinuteToFolder`
 * 를 쓴다) 이 액션을 막는 것이 곧 D&D 차단이다.
 *
 * 게이트가 인증보다 **앞**이어야 한다 — 뒤에 두면 로그인 여부에 따라 서로 다른 오류가
 * 나가 기능 존재가 드러나고, DB 왕복도 낭비한다.
 */

const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getMembership, getSession } from '@/lib/auth'
import { moveMinuteFolder, moveMinuteToFolder } from '@/app/actions/minutes'

const ADMIN = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' } as const
const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const

beforeEach(() => {
  vi.clearAllMocks()
  state.client = undefined
  vi.unstubAllEnvs()
  vi.mocked(getMembership).mockResolvedValue(ADMIN as never)
  vi.mocked(getSession).mockResolvedValue(USER as never)
})

describe('moveMinuteFolder — MINUTES_FOLDER_DND_ENABLED 게이트', () => {
  it('플래그 미설정이면 pmo_admin 이어도 거절한다 (기본 닫힘)', async () => {
    const res = await moveMinuteFolder('f-a', 'f-b')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('열려 있지 않습니다')
  })

  it("플래그가 'false' 여도 거절한다", async () => {
    vi.stubEnv('MINUTES_FOLDER_DND_ENABLED', 'false')
    expect((await moveMinuteFolder('f-a', 'f-b')).ok).toBe(false)
  })

  it("'true' 이외의 값은 전부 닫힘으로 읽는다 — 오설정이 기능을 여는 일이 없게", async () => {
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      vi.stubEnv('MINUTES_FOLDER_DND_ENABLED', v)
      expect((await moveMinuteFolder('f-a', 'f-b')).ok, `env=${v}`).toBe(false)
    }
  })

  it('게이트는 인증보다 앞이다 — 미로그인이어도 같은 사유로 거절하고 DB 를 건드리지 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    vi.mocked(getMembership).mockResolvedValue(null as never)
    const res = await moveMinuteFolder('f-a', 'f-b')
    expect(res.error).toContain('열려 있지 않습니다')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it("플래그가 'true' 면 게이트를 통과해 기존 검증으로 넘어간다", async () => {
    vi.stubEnv('MINUTES_FOLDER_DND_ENABLED', 'true')
    // 루트 이동 금지(§6.3 불변식)는 게이트 **뒤**의 순수 검증이라 DB 없이 도달한다.
    const res = await moveMinuteFolder('f-a', null)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('담당 팀 폴더 안에만')
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('moveMinuteToFolder — 게이트 대상이 아니다', () => {
  // [이동] 버튼의 폴더 픽커와 업로드·수정 모달이 같은 액션을 쓴다. 여기까지 막으면
  // 결정이 요구하지 않은 기능까지 닫힌다(사용자 결정: D&D 한정).
  it('플래그가 닫혀 있어도 기존 검증 경로로 들어간다', async () => {
    const res = await moveMinuteToFolder('m-1', null)
    expect(res.ok).toBe(false)
    // D&D 게이트 문구가 아니라 §6.3 불변식 문구여야 한다
    expect(res.error).toContain('폴더 밖으로 옮길 수 없습니다')
    expect(res.error).not.toContain('열려 있지 않습니다')
  })
})
