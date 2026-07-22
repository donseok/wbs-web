'use server'
import { getMembership, getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { classifyRecipients } from '@/lib/mail/recipients'
import { renderMeetingInvite } from '@/lib/mail/meetingInvite'
import { getTransport } from '@/lib/mail/transport'
import { displayNameFrom } from '@/lib/domain/display-name'
import type { MeetingNotifyResult } from '@/lib/mail/outcome'

const NONE = { sentTo: [] as string[], skipped: [] as MeetingNotifyResult['skipped'] }

/** 메일 본문 링크의 절대 주소. 없으면 링크를 생략한다(상대경로 링크는 메일에서 무의미하다). */
function resolveAppUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : null
}

/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다. 사용자에게는 사유만 전한다. */
function toUserMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return '메일 서버에 연결하지 못했습니다.'
  }
  return '메일 발송 중 오류가 발생했습니다.'
}

/**
 * 회의 참석자에게 안내 메일을 보낸다.
 * createMeeting 이 커밋된 뒤에 호출되므로, 여기서 무엇이 실패하든 회의 데이터는 남는다.
 * 인자가 meetingId 뿐인 것은 의도적이다 — 수신자는 서버가 DB 에서 다시 읽는다.
 */
export async function notifyMeetingCreated(meetingId: string): Promise<MeetingNotifyResult> {
  const [membership, user] = await Promise.all([getMembership(), getSession()])
  if (!membership || !user) return { ok: false, error: '로그인 필요', ...NONE }

  const detail = await getMeetingDetail(meetingId)
  if (!detail) return { ok: false, error: '회의를 찾을 수 없습니다.', ...NONE }
  const { meeting, attendees } = detail

  // 남의 회의 ID 로 메일을 반복 발송하는 통로를 막는 유일한 지점.
  const isOwner = meeting.createdBy === user.id
  if (!isOwner && membership.role !== 'pmo_admin') return { ok: false, error: '권한 없음', ...NONE }

  const { valid, skipped } = classifyRecipients(attendees)
  // 빈 To 로 SMTP 를 때리면 계정 평판만 깎인다.
  if (valid.length === 0) return { ok: true, sentTo: [], skipped }

  const transport = getTransport()
  if (!transport.ok) return { ok: false, error: transport.error, sentTo: [], skipped }

  const { subject, html, text } = renderMeetingInvite({
    meeting,
    attendeeNames: attendees.map(a => a.name),
    // displayNameFrom 도 null 을 낼 수 있다. 빈 문자열이면 렌더러가 '작성자' 줄 자체를 생략한다.
    senderName: meeting.createdByName ?? displayNameFrom(user.user_metadata, user.email) ?? '',
    appUrl: resolveAppUrl(),
  })

  try {
    // Reply-To 는 호출자다. 회의 작성자의 이메일은 auth.users 에 있어 anon 클라이언트로 읽을 수 없고,
    // 사실상 작성 직후 본인이 호출한다(pmo_admin 대행은 예외적 경로).
    const { rejected } = await transport.send({
      to: valid.map(v => v.email),
      replyTo: user.email ?? null,
      subject, html, text,
    })

    const rejectedSet = new Set(rejected.map(r => r.trim().toLowerCase()))
    return {
      ok: true,
      sentTo: valid.filter(v => !rejectedSet.has(v.email)).map(v => v.name),
      skipped: [
        ...skipped,
        ...valid.filter(v => rejectedSet.has(v.email))
          .map(v => ({ name: v.name, reason: 'rejected' as const })),
      ],
    }
  } catch (e) {
    console.error('[notifyMeetingCreated] 발송 실패:', e)
    return { ok: false, error: toUserMessage(e), sentTo: [], skipped }
  }
}
