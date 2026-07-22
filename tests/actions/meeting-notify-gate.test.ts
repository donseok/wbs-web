import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트를 통과하기 전에는 트랜스포트를 만들면 안 된다.
const { getTransport, send } = vi.hoisted(() => {
  const send = vi.fn()
  return { send, getTransport: vi.fn(() => ({ ok: true, send })) }
})
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getMeetingDetail: vi.fn() }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))

import { getMembership, getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { notifyMeetingCreated } from '@/app/actions/meetingNotify'

const USER = { id: 'u1', email: 'me@dongkuk.com', user_metadata: { full_name: '김철수' } }

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

describe('notifyMeetingCreated 권한 게이트', () => {
  beforeEach(() => {
    getTransport.mockClear(); send.mockReset()
    // getMeetingDetail 은 '호출되지 않았다' 를 단언하므로 매 테스트 초기화한다.
    vi.mocked(getMeetingDetail).mockClear()
    vi.mocked(getSession).mockResolvedValue(USER as never)
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor' } as never)
  })

  it('로그인하지 않으면 거부하고 회의를 조회하지도 않는다', async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    vi.mocked(getMembership).mockResolvedValue(null as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '로그인 필요' })
    expect(getMeetingDetail).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('없는 회의는 거부한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(null as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '회의를 찾을 수 없습니다.' })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('작성자도 pmo_admin 도 아니면 거부하고 트랜스포트를 만들지 않는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(getTransport).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('pmo_admin 은 남의 회의도 보낼 수 있다', async () => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin' } as never)
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }], 'someone-else') as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: true, sentTo: ['박영희'] })
  })
})

describe('notifyMeetingCreated 발송', () => {
  beforeEach(() => {
    getTransport.mockClear(); send.mockReset()
    vi.mocked(getSession).mockResolvedValue(USER as never)
    vi.mocked(getMembership).mockResolvedValue({ role: 'team_editor' } as never)
  })

  it('유효 주소가 없으면 전송을 시도하지 않고 ok:true 로 전원 제외를 보고한다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: null }]) as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toEqual({ ok: true, sentTo: [], skipped: [{ name: '박영희', reason: 'no_email' }] })
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('Reply-To 를 호출자 이메일로 지정하고 유효 주소만 To 에 넣는다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(detail([
      { id: 'a1', name: '박영희', email: 'y@dongkuk.com' },
      { id: 'a2', name: '이민수', email: 'broken-email' },
    ]) as never)
    send.mockResolvedValue({ rejected: [] })

    const res = await notifyMeetingCreated('m1')

    // to/replyTo 만 보면 액션→렌더러 배선이 끊겨 본문이 비어도 이 파일 전체가 초록이다.
    // 제목과 HTML 본문이 실제 회의 내용을 담고 나갔는지까지 못박는다.
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['y@dongkuk.com'],
      replyTo: 'me@dongkuk.com',
      subject: expect.stringContaining('주간 점검'),
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

    const res = await notifyMeetingCreated('m1')

    expect(res.sentTo).toEqual(['박영희'])
    expect(res.skipped).toEqual([{ name: '최지훈', reason: 'rejected' }])
  })

  it('트랜스포트 미설정이면 그 사유를 그대로 올린다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    getTransport.mockReturnValueOnce({ ok: false, error: '메일 발송이 설정되지 않았습니다.' } as never)
    const res = await notifyMeetingCreated('m1')
    expect(res).toMatchObject({ ok: false, error: '메일 발송이 설정되지 않았습니다.' })
  })

  it('EAUTH 는 자격증명을 노출하지 않는 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' }))
    const res = await notifyMeetingCreated('m1')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.')
    expect(res.error).not.toContain('Password')
  })

  it('타임아웃은 연결 실패 문구로 바꾼다', async () => {
    vi.mocked(getMeetingDetail).mockResolvedValue(
      detail([{ id: 'a1', name: '박영희', email: 'y@dongkuk.com' }]) as never)
    send.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    const res = await notifyMeetingCreated('m1')
    expect(res.error).toBe('메일 서버에 연결하지 못했습니다.')
  })
})
