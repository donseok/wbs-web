'use server'
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAllAuthUsers } from '@/lib/data/accounts'
import { activeTeamCodesForProjectSync } from '@/lib/teams/master'
import { isTeamCode } from '@/lib/domain/accounts'
import { isValidEmail } from '@/lib/domain/validate'
import { displayNameFrom } from '@/lib/domain/display-name'
import { getTransport } from '@/lib/mail/transport'
import { renderInviteMail } from '@/lib/mail/projectInvite'
import {
  DEFAULT_INVITE_DAYS, inviteStatus, isAllowedInviteDomain, normalizeInviteDays,
  normalizeInviteEmail, parseAllowedDomains, type InviteStatus,
} from '@/lib/domain/invites'

type AdminClient = ReturnType<typeof createAdminClient>

// 사용자에게 나가는 문구는 설계 §8 표의 원문이다. 원시 Postgres/Supabase 메시지를 그대로
// 올리지 않는다 — 초대 표면은 비로그인 경로와 맞닿아 있어 내부 구조를 흘리면 안 된다.
const ERR_LOOKUP = '초대를 확인할 수 없어 중단했습니다.'
const ERR_EMAIL = '이메일 형식을 확인해 주세요.'
const ERR_TEAM = '알 수 없는 팀 코드'
const ERR_DAYS = '유효기간은 1~30일 사이여야 합니다.'
const ERR_DUP = '이 주소로 발급한 초대가 아직 유효합니다. 취소 후 다시 보내세요.'
/** 만료분만 남아 부분 유니크를 막고 있는 경우. 관리자가 취소 버튼을 눌러야 길이 열린다. */
const ERR_DUP_EXPIRED = '이 주소로 발급한 초대가 남아 있습니다. 목록에서 취소한 뒤 다시 보내세요.'
const ERR_REVOKE = '취소할 수 있는 초대가 아닙니다.'
const ERR_APP_URL = '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.'
const ERR_INIT = '연결 초기화 설정을 확인하세요.'

/** 도메인 거부 문구는 실제 판정에 쓰인 목록으로 조립한다 — 하드코딩하면 다른 도메인을
 *  설정한 배포에서 관리자가 "무엇을 넣어야 하는지" 거짓 안내를 받는다. */
function domainError(domains: string[]): string {
  return `사내 이메일 주소(${domains.map((d) => `@${d}`).join(', ')})로만 초대할 수 있습니다.`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 초대 행 조회 열 — token 을 포함하므로 이 파일 밖으로 원본을 흘리지 않는다.
 *  token 은 링크 조립에만 쓰고 InviteRow 에는 싣지 않는다(RSC 페이로드로 새어나간다). */
const INVITE_COLUMNS = 'id, token, email, created_at, expires_at, revoked_at, redeemed_at'

export interface InviteRow {
  id: string
  email: string
  teamCode: string | null
  status: InviteStatus
  expiresAt: string
  createdAt: string
  redeemedAt: string | null
  /** 서버가 조립한 초대 링크. NEXT_PUBLIC_APP_URL 미설정이면 null —
   *  UI 가 window.location.origin 을 읽으면 서버 프리렌더에서 죽는다(설계 §7-1).
   *  status 가 'active' 인 행에만 채운다: 나머지는 눌러도 실패할 링크이고,
   *  쓸 수 없는 토큰을 브라우저까지 실어 보낼 이유가 없다. */
  url: string | null
}

export interface CreateInviteInput {
  email: string
  teamCode: string
  days?: number
}

export interface CreateInviteResult {
  ok: true
  row: InviteRow
  url: string
  mailed: boolean
  mailError?: string
  /** 이미 계정이 있는 주소인가(있으면 링크가 '로그인하고 합류' 경로가 된다).
   *  확인 자체가 실패하면 null — 발급을 막을 사유는 아니지만 없는 사실을 지어내지도 않는다. */
  alreadyAccount: boolean | null
}

/**
 * 초대 링크의 절대 origin. 상대 경로 링크는 메일에서 무의미하고, 틀린 origin 의 링크는
 * 발송된 뒤에 회수할 수 없다 — 미설정이면 초대를 만들지 않는다(fail-closed, 설계 §5-1.2).
 * meetingNotify 의 VERCEL_* 폴백은 쓰지 않는다: 그 주소는 배포마다 달라져 1회용 링크와 맞지 않는다.
 */
function inviteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

function inviteUrl(origin: string | null, token: string): string | null {
  return origin ? `${origin}/invite/${token}` : null
}

/** SMTP 원문 에러에는 계정·호스트 정보가 섞인다(meetingNotify 와 같은 이유). */
function toMailMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  if (code === 'EAUTH') return '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
    return '메일 서버에 연결하지 못했습니다.'
  }
  return '메일 발송 중 오류가 발생했습니다.'
}

/** 팀 코드 → teams.id — 프로젝트 행 우선, 전역 폴백(0071 스코프. import RPC 와 같은 규칙). */
async function resolveTeamId(admin: AdminClient, teamCode: string, projectId: string): Promise<string | null> {
  const { data, error } = await admin.from('teams')
    .select('id, project_id')
    .eq('code', teamCode)
    .or(`project_id.eq.${projectId},project_id.is.null`)
  // 쓰기 직전의 조회 — null 이면 호출부가 발급을 중단하므로 이미 fail-closed다.
  // 다만 '팀이 없음'과 '조회가 깨짐'이 화면에서 같은 문구가 되므로 원인은 로그로 남긴다.
  if (error) console.error('[projectInvites.resolveTeamId] 조회 실패:', error.message)
  const rows = (data ?? []) as Array<{ id: string; project_id: string | null }>
  return (rows.find(r => r.project_id !== null) ?? rows[0])?.id ?? null
}

type RawInvite = {
  id: unknown; token: unknown; email: unknown
  created_at: unknown; expires_at: unknown; revoked_at: unknown; redeemed_at: unknown
}

function toInviteRow(r: RawInvite, teamCode: string | null, origin: string | null, now: Date): InviteRow {
  const expiresAt = String(r.expires_at)
  const revokedAt = (r.revoked_at as string | null) ?? null
  const redeemedAt = (r.redeemed_at as string | null) ?? null
  const status = inviteStatus({ expiresAt, revokedAt, redeemedAt }, now)
  // token 은 여기서만 읽고 지역 변수로 끝낸다 — 반환 객체에 실으면 설정 화면의 RSC
  // 페이로드에 전 초대의 원본 토큰이 그대로 적재된다.
  return {
    id: String(r.id),
    email: String(r.email),
    teamCode,
    status,
    expiresAt,
    createdAt: String(r.created_at),
    redeemedAt,
    url: status === 'active' ? inviteUrl(origin, String(r.token)) : null,
  }
}

/**
 * 프로젝트의 초대 목록(최신순).
 *
 * 조회 실패를 빈 목록으로 위장하지 않는다 — '초대 0건'은 관리자가 "아직 안 보냈구나"로 읽고
 * 같은 주소로 다시 발급하게 만드는 오정보다(그리고 부분 유니크에 막혀 이유 없이 실패한다).
 */
export async function listProjectInvites(
  projectId: string,
): Promise<{ ok: true; rows: InviteRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[listProjectInvites] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  const { data, error } = await admin
    .from('project_invites')
    .select(`${INVITE_COLUMNS}, teams(code)`)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error || !data) {
    console.error('[listProjectInvites] 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_LOOKUP }
  }

  const origin = inviteOrigin()
  const now = new Date()
  const rows = data.map((r) => {
    const team = (r as { teams?: unknown }).teams as { code?: unknown } | null
    return toInviteRow(r as RawInvite, (team?.code as string | undefined) ?? null, origin, now)
  })
  return { ok: true, rows }
}

/**
 * 초대 발급 + 메일 발송.
 *
 * 메일 실패는 초대를 무효화하지 않는다 — 링크는 이미 유효하고, 관리자가 복사해 전달하면
 * 그만이다. 발송 실패를 이유로 행을 지우면 관리자에게는 '아무 일도 없었다'로 보이지만
 * 실제로는 메일이 이미 나갔을 수도 있다(SMTP 는 부분 성공을 낸다).
 */
export async function createProjectInvite(
  projectId: string, input: CreateInviteInput,
): Promise<CreateInviteResult | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  // 입력 검증 → origin 확인까지는 DB 를 건드리지 않는다. 어차피 만들 수 없는 초대라면
  // 흔적도 남기지 않는 편이 낫다.
  const email = normalizeInviteEmail(input.email ?? '')
  if (!isValidEmail(email)) return { ok: false, error: ERR_EMAIL }
  const domains = parseAllowedDomains(process.env.INVITE_ALLOWED_DOMAINS)
  if (!isAllowedInviteDomain(email, domains)) return { ok: false, error: domainError(domains) }
  if (!isTeamCode(input.teamCode, activeTeamCodesForProjectSync(projectId))) return { ok: false, error: ERR_TEAM }
  const days = normalizeInviteDays(input.days ?? DEFAULT_INVITE_DAYS)
  if (days === null) return { ok: false, error: ERR_DAYS }

  const origin = inviteOrigin()
  if (!origin) return { ok: false, error: ERR_APP_URL }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[createProjectInvite] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  // 메일 제목·본문에 들어갈 프로젝트명. 쓰기 전 선행 조회이므로 실패는 중단이다(3원칙 ②) —
  // 프로젝트가 없으면 어차피 FK 가 거부한다.
  const { data: project, error: projectErr } = await admin
    .from('projects').select('name').eq('id', projectId).maybeSingle()
  if (projectErr) {
    console.error('[createProjectInvite] 프로젝트 조회 실패:', projectErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!project) return { ok: false, error: '프로젝트를 찾을 수 없습니다.' }

  const teamId = await resolveTeamId(admin, input.teamCode, projectId)
  if (!teamId) return { ok: false, error: '팀을 찾을 수 없습니다.' }

  // 기존 계정이 있으면 링크가 '로그인하고 합류' 경로가 된다 — 발급을 막지는 않고 안내만 한다.
  const alreadyAccount = await hasAccount(admin, email)

  const now = new Date()
  const dup = await checkBlockingInvites(admin, projectId, email, now)
  if (!dup.ok) return dup

  const token = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + days * DAY_MS).toISOString()
  const { data: inserted, error: insErr } = await admin
    .from('project_invites')
    .insert({
      project_id: projectId, token, email, team_id: teamId,
      created_by: g.actor.userId, expires_at: expiresAt,
    })
    .select(INVITE_COLUMNS)
    .single()
  if (insErr || !inserted) {
    // 부분 유니크 위반 = 위 확인과 insert 사이에 다른 관리자가 먼저 발급했다는 뜻이다.
    if ((insErr as { code?: string } | null)?.code === '23505') return { ok: false, error: ERR_DUP }
    // 토큰은 로그에 남기지 않는다 — 로그 열람 권한이 곧 가입 자격이 되어서는 안 된다.
    console.error('[createProjectInvite] 저장 실패:', insErr?.message ?? 'unknown')
    return { ok: false, error: '초대를 저장하지 못했습니다.' }
  }

  const row = toInviteRow(inserted as RawInvite, input.teamCode, origin, now)
  const url = `${origin}/invite/${token}`
  const mail = await sendInviteMail(admin, {
    to: email, projectName: String(project.name ?? ''), inviterId: g.actor.userId, url, expiresAt,
  })

  revalidatePath(`/p/${projectId}/settings`)
  return { ok: true, row, url, alreadyAccount, ...mail }
}

/**
 * 부분 유니크(redeemed_at is null and revoked_at is null)를 막고 있는 초대가 있으면 거부한다.
 *
 * 유니크는 만료 여부를 보지 않으므로 만료된 초대도 여전히 길을 막는다. 그렇다고 여기서
 * 자동으로 소프트 취소하지는 않는다 — 아무도 취소하지 않은 초대가 목록에 영구히 '취소됨'으로
 * 남으면, "누가 언제 무엇을 취소했나"를 근거로 삼는 소프트 취소의 의미(설계 P5)가 깎인다.
 * 치우는 일은 관리자의 명시적 취소로만 한다(취소 버튼은 만료 행에도 동작한다 —
 * revokeProjectInvite 참조). 그래서 문구도 활성/만료를 구분해 다음 행동을 정확히 알려준다.
 */
async function checkBlockingInvites(
  admin: AdminClient, projectId: string, email: string, now: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('project_invites')
    .select('id, expires_at, revoked_at, redeemed_at')
    .eq('project_id', projectId).eq('email', email)
    .is('redeemed_at', null).is('revoked_at', null)
  if (error || !data) {
    // 확인이 안 되면 발급하지 않는다 — 중복 판정 없이 insert 하면 유니크 위반만 남고
    // 관리자에게는 원인 없는 실패로 보인다(3원칙 ②).
    console.error('[createProjectInvite] 중복 초대 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_LOOKUP }
  }
  if (data.length === 0) return { ok: true }

  const hasActive = data.some(r => inviteStatus({
    expiresAt: String(r.expires_at),
    revokedAt: (r.revoked_at as string | null) ?? null,
    redeemedAt: (r.redeemed_at as string | null) ?? null,
  }, now) === 'active')
  return { ok: false, error: hasActive ? ERR_DUP : ERR_DUP_EXPIRED }
}

/** 이미 계정이 있는 주소인가. 확인 실패는 null — 발급을 막을 사유가 아니다(표시 = 로깅). */
async function hasAccount(admin: AdminClient, email: string): Promise<boolean | null> {
  try {
    const users = await listAllAuthUsers(admin)
    return users.some(u => normalizeInviteEmail(u.email) === email)
  } catch (e) {
    console.error('[createProjectInvite] 계정 존재 확인 실패:', e instanceof Error ? e.message : e)
    return null
  }
}

/** 초대 메일 1통. 실패는 결과에 담아 올린다 — 초대 자체는 이미 유효하다. */
async function sendInviteMail(
  admin: AdminClient,
  i: { to: string; projectName: string; inviterId: string; url: string; expiresAt: string },
): Promise<{ mailed: boolean; mailError?: string }> {
  const transport = getTransport()
  if (!transport.ok) return { mailed: false, mailError: transport.error }

  // 초대한 사람의 이름·주소는 본문 한 줄과 Reply-To 에만 쓰인다. 못 읽어도 발송은 계속한다.
  let inviterName: string | null = null
  let inviterEmail: string | null = null
  const { data: inviter, error: inviterErr } = await admin.auth.admin.getUserById(i.inviterId)
  if (inviterErr || !inviter?.user) {
    console.error('[createProjectInvite] 초대자 정보 조회 실패:', inviterErr?.message ?? 'unknown')
  } else {
    inviterName = displayNameFrom(inviter.user.user_metadata, inviter.user.email)
    inviterEmail = inviter.user.email ?? null
  }

  const { subject, html, text } = renderInviteMail({
    projectName: i.projectName, inviterName, url: i.url, expiresAt: i.expiresAt,
  })
  try {
    const { rejected } = await transport.send({
      to: [i.to], replyTo: inviterEmail, subject, html, text,
    })
    if (rejected.some(r => normalizeInviteEmail(r) === i.to)) {
      return { mailed: false, mailError: '메일 서버가 수신 주소를 거부했습니다.' }
    }
    return { mailed: true }
  } catch (e) {
    console.error('[createProjectInvite] 메일 발송 실패:', e)
    return { mailed: false, mailError: toMailMessage(e) }
  }
}

/**
 * 소프트 취소. 행을 지우지 않는다 — "누가 만든 어떤 초대로 누가 언제 들어왔나"가
 * 사고 때 되짚을 유일한 근거다(설계 P5).
 *
 * update 에 .select('id') 를 붙여 영향 행 수를 확인한다. 붙이지 않으면 0행(다른 프로젝트의
 * 초대·이미 합류·이미 취소)과 1행이 구분되지 않아 조용한 no-op 이 성공으로 보고된다.
 */
export async function revokeProjectInvite(
  projectId: string, inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  let admin: AdminClient
  try {
    admin = createAdminClient()
  } catch (e) {
    console.error('[revokeProjectInvite] admin client 생성 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_INIT }
  }

  const { data, error } = await admin
    .from('project_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    // project_id 조건이 곧 권한 경계다 — 게이트는 이 프로젝트의 관리자임만 확인한다.
    .eq('project_id', projectId)
    // 만료 행도 취소 가능(재발급 경로) — expires_at 조건을 일부러 걸지 않는다.
    // 만료분이 부분 유니크를 막고 있으므로, 취소할 수 없으면 같은 주소로 다시 보낼 길이 없다.
    .is('redeemed_at', null)
    .is('revoked_at', null)
    .select('id')
  if (error) {
    console.error('[revokeProjectInvite] 취소 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data || data.length === 0) return { ok: false, error: ERR_REVOKE }

  revalidatePath(`/p/${projectId}/settings`)
  return { ok: true }
}
