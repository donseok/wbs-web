import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트를 통과하기 전에는 트랜스포트를 만들면 안 된다.
const { getTransport, send } = vi.hoisted(() => {
  const send = vi.fn()
  return { send, getTransport: vi.fn(() => ({ ok: true, send })) }
})
const { requireProjectAdmin, resolveProjectId, getActor } = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId, getActor }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingDetail: vi.fn() }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))

import { getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { notifyMeetingSaved } from '@/app/actions/meetingNotify'

const USER = { id: 'u1', email: 'me@dongkuk.com', user_metadata: { full_name: '김철수' } }
const ACTOR = { userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false, projectRoles: new Map() }

/** 로그인했지만 이 프로젝트의 관리자는 아니다 — 작성자 본인일 때만 통과해야 한다. */
function asNonAdmin() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
  getActor.mockResolvedValue(ACTOR)
}
/** 이 프로젝트의 관리자 — 남의 회의도 대행 발송할 수 있다. */
function asProjectAdmin() {
  requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
}
/** 비로그인 — 가드가 '로그인 필요'를 내고 getActor 도 null 이다. */
function asAnon() {
  requireProjectAdmin.mockResolvedValue({ ok: false, error: '로그인 필요' })
  getActor.mockResolvedValue(null)
}

beforeEach(() => {
  getTransport.mockClear(); send.mockReset()
  requireProjectAdmin.mockReset(); getActor.mockReset(); resolveProjectId.mockReset()
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  // getMeetingDetail 은 '호출되지 않았다' 를 단언하므로 매 테스트 초기화한다.
  vi.mocked(getMeetingDetail).mockReset()
  vi.mocked(getSession).mockResolvedValue(USER as never)
  asNonAdmin()
})

const MEETING = {
  id: 'm1', projectId: 'p1', title: '주간 점검', meetingDate: '2026-07-25',
  startTime: '14:00', endTime: '15:00', location: null, category: 'routine' as const,
  body: '', recurrence: 'none' as const, recurrenceUntil: null,
  createdBy: 'u1', createdByName: '김철수',
  createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z', attendeeIds: [],
}

function detail(attendees: { id: string; name: string; email: string | null }[], createdBy = 'u1') {
  return {
    meeting: { ...MEETING, createdBy },
    attendees: attendees.map(a => ({ ...a, teamCode: null })),
  }
}

describe('notifyMeetingSaved 권한 게이트', () => {
  it('로그인하지 않으면 거부하고 회의를 조회하지도 않는다', async () => {
    asAnon()
    vi.mocked(getSession).mockResolvedValue(null as never)
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  // 권한 판정의 기준(회의가 속한 프로젝트)을 못 읽으면 발송으로 나아가지 않는다 — fail-closed.
  it('대상 회의의 프로젝트를 확정하지 못하면 회의를 조회하지도 않는다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('없는 회의는 거부한다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('게이트 통과 후 상세가 사라졌으면 거부한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(null as never)
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '회의를 찾을 수 없습니다.' })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('작성자도 프로젝트 관리자도 아니면 거부하고 트랜스포트를 만들지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(getTransport).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자는 남의 회의도 보낼 수 있다', async () => {
    asProjectAdmin()
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
  })
})

describe('notifyMeetingSaved 발송', () => {
  it('유효 주소가 없으면 전송을 시도하지 않고 ok:true 로 전원 제외를 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: null }]) as never)
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toEqual({ ok: true, sentTo: [], skipped: [{ name: '박영희', reason: 'no_email' }] })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('Reply-To 를 호출자 이메일로 지정하고 유효 주소만 To 에 넣는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([
      { id: 'a1', name: '박영희', email: 'y@dongkuk.com' },
      { id: 'a2', name: '이민수', email: 'broken-email' },
    ]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created')

    // to/replyTo 만 보면 액션→렌더러 배선이 끊겨 본문이 비어도 이 파일 전체가 초록이다.
    // 제목과 HTML 본문이 실제 회의 내용을 담고 나갔는지까지 못박는다.
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com'],
      replyTo: 'me@dongkuk.com',
      subject: expect.stringMatching(/^\[회의 안내\] 주간 점검/),
      html: expect.stringContaining('박영희'),
      text: expect.stringContaining('주간 점검'),
    }))
    expect(res.sentTo).toEqual(['박영희'])
    expect(res.skipped).toEqual([{ name: '이민수', reason: 'invalid_email' }])
  })

  it('SMTP 가 거절한 주소를 rejected 로 합쳐 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([
      { id: 'a1', name: '박영희', email: 'y@dongkuk.com' },
      { id: 'a2', name: '최지훈', email: 'j@dongkuk.com' },
    ]) as never)
    send.mockResolvedValue({ rejected: ['J@dongkuk.com'] })

    const res = await notifyMeetingSaved('m1', 'created')

    expect(res.sentTo).toEqual(['박영희'])
    expect(res.skipped).toEqual([{ name: '최지훈', reason: 'rejected' }])
  })

  it('트랜스포트 미설정이면 그 사유를 그대로 올린다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    getTransport.mockReturnValueOnce({ ok: false, error: '메일 발송이 설정되지 않았습니다.' } as never)
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res).toMatchObject({ ok: false, error: '메일 발송이 설정되지 않았습니다.' })
  })

  it('EAUTH 는 자격증명을 노출하지 않는 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' }))
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.')
    expect(res.error).not.toContain('Password')
  })

  it('타임아웃은 연결 실패 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const res = await notifyMeetingSaved('m1', 'created')
    expect(res.error).toBe('메일 서버에 연결하지 못했습니다.')
  })
})

describe('notifyMeetingSaved — 추가 수신 이메일', () => {
  it('추가 이메일을 참석자와 함께 To 에 넣고 주소를 sentTo 로 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created', ['guest@partner.co.kr'])

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com', 'guest@partner.co.kr'],
    }))
    expect(res.sentTo).toEqual(['박영희', 'guest@partner.co.kr'])
  })

  it('참석자가 없어도 추가 이메일만으로 발송한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created', ['guest@partner.co.kr'])

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['guest@partner.co.kr'] }))
    expect(res).toMatchObject({ ok: true, sentTo: ['guest@partner.co.kr'] })
  })

  it('참석자와 겹치는 추가 이메일은 한 번만 보낸다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created', ['Y@dongkuk.com'])

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['y@dongkuk.com'] }))
    expect(res.sentTo).toEqual(['박영희'])
  })

  it('형식이 깨진 추가 이메일은 주소를 이름으로 skipped 에 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created', ['broken-email'])

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['y@dongkuk.com'] }))
    expect(res.skipped).toEqual([{ name: 'broken-email', reason: 'invalid_email' }])
  })

  it('상한을 넘는 추가 이메일은 회의 조회 전에 거부한다', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `g${i}@x.com`)
    const res = await notifyMeetingSaved('m1', 'created', many)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('최대 20개')
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('문자열이 아닌 원소는 버린다 — 클라이언트가 임의 JSON 을 보내도 죽지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'created', [42, null, 'guest@partner.co.kr'] as never)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com', 'guest@partner.co.kr'],
    }))
    expect(res.ok).toBe(true)
  })

  it('작성자도 프로젝트 관리자도 아니면 추가 이메일이 있어도 거부한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    const res = await notifyMeetingSaved('m1', 'created', ['guest@partner.co.kr'])
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(getTransport).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('notifyMeetingSaved — 변경 안내', () => {
  it("kind:'updated' 는 변경 제목으로 전송한다", async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'updated')

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com'],
      subject: expect.stringMatching(/^\[회의 변경\] 주간 점검/),
      html: expect.stringContaining('박영희'),
    }))
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
  })

  // 수정 경로가 게이트를 건너뛰면 남의 회의 ID 로 참석자 전원에게 메일을 반복 발송할 수 있다.
  it('수정 경로도 작성자·프로젝트 관리자가 아니면 거부하고 트랜스포트를 만들지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    const res = await notifyMeetingSaved('m1', 'updated')
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(getTransport).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('수정 경로도 로그인하지 않으면 회의를 조회하지 않는다', async () => {
    asAnon()
    vi.mocked(getSession).mockResolvedValue(null as never)
    const res = await notifyMeetingSaved('m1', 'updated')
    expect(res).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('수정 경로도 참석자 명단에서 빠진 사람에게는 보내지 않는다', async () => {
    // 수정 후 명단만 조회하므로, 빠진 사람의 주소는 To 에 들어갈 길이 없다.
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a2', name: '최지훈', email: 'j@dongkuk.com' }]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingSaved('m1', 'updated')

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['j@dongkuk.com'] }))
    expect(res.sentTo).toEqual(['최지훈'])
  })
})
