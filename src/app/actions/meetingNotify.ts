'use server'
import { getMembership, getSession } from '@/lib/auth'
import { getMeetingDetail } from '@/lib/data/meetings'
import { classifyRecipients, MAX_EXTRA_EMAILS } from '@/lib/mail/recipients'
import { renderMeetingInvite, type InviteKind } from '@/lib/mail/meetingInvite'
import { getTransport } from '@/lib/mail/transport'
import { displayNameFrom } from '@/lib/domain/display-name'
import { sortByKoreanName } from '@/lib/domain/nameSort'
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
 * 회의 참석자에게 안내(생성)·변경(수정) 메일을 보낸다.
 * createMeeting/updateMeeting 이 커밋된 뒤에 호출되므로, 여기서 무엇이 실패하든 회의 데이터는 남는다.
 * 참석자 수신자는 서버가 DB 에서 다시 읽는다 — 수정으로 명단에서 빠진 사람은
 * 조회 결과에 아예 없고, 메일을 받을 길도 없다.
 * extraEmails 는 예외다: 폼에서만 살고 어디에도 저장되지 않는 외부 수신 주소라 DB 에서
 * 읽을 원본이 없다. 작성자·pmo_admin 게이트를 지난 호출자만 넣을 수 있고,
 * 개수 상한과 주소 검증(classifyRecipients)을 서버에서 다시 통과해야 To 에 실린다.
 */
export async function notifyMeetingSaved(
  meetingId: string,
  kind: InviteKind,
  extraEmails: string[] = [],
): Promise<MeetingNotifyResult> {
  const [membership, user] = await Promise.all([getMembership(), getSession()])
  if (!membership || !user) return { ok: false, error: '로그인 필요', ...NONE }

  // 서버 액션 인자는 클라이언트가 임의로 만든다 — 타입과 개수를 여기서 다시 못박는다.
  const extras = Array.isArray(extraEmails)
    ? extraEmails.filter((e): e is string => typeof e === 'string')
    : []
  if (extras.length > MAX_EXTRA_EMAILS) {
    return { ok: false, error: `추가 수신 이메일은 최대 ${MAX_EXTRA_EMAILS}개까지 입력할 수 있습니다.`, ...NONE }
  }

  const detail = await getMeetingDetail(meetingId)
  if (!detail) return { ok: false, error: '회의를 찾을 수 없습니다.', ...NONE }
  const { meeting, attendees } = detail

  // 남의 회의 ID 로 메일을 반복 발송하는 통로를 막는 유일한 지점.
  const isOwner = meeting.createdBy === user.id
  if (!isOwner && membership.role !== 'pmo_admin') return { ok: false, error: '권한 없음', ...NONE }

  const { valid, skipped } = classifyRecipients(attendees, extras)
  // 빈 To 로 SMTP 를 때리면 계정 평판만 깎인다.
  if (valid.length === 0) return { ok: true, sentTo: [], skipped }

  const transport = getTransport()
  if (!transport.ok) return { ok: false, error: transport.error, sentTo: [], skipped }

  const { subject, html, text } = renderMeetingInvite({
    kind,
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
      // 두 그룹(메일 없음·형식 오류 / 발송 거부)을 이어 붙이면 이름 순서가 경계에서 한 번 되감긴다.
      // 결과 패널은 '이름(사유)' 를 한 줄로 나열하므로 합친 뒤 다시 가나다순으로 맞춘다.
      skipped: sortByKoreanName([
        ...skipped,
        ...valid.filter(v => rejectedSet.has(v.email))
          .map(v => ({ name: v.name, reason: 'rejected' as const })),
      ], s => s.name),
    }
  } catch (e) {
    console.error(`[notifyMeetingSaved:${kind}] 발송 실패:`, e)
    return { ok: false, error: toUserMessage(e), sentTo: [], skipped }
  }
}
