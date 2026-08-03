'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAllAuthUsers } from '@/lib/data/accounts'
import {
  isInviteToken, inviteStatus, maskEmail, normalizeInviteEmail, validateSignupInput,
  type InviteStatus, type SignupInput,
} from '@/lib/domain/invites'

type AdminClient = ReturnType<typeof createAdminClient>

// 인증 게이트가 없는 공개 경로다(링크를 가진 사람이 곧 호출자). 방어선은 셋뿐이다:
// ① 토큰 형식 검증 ② 초대 행이 못 박은 이메일 ③ 소비 RPC 의 원자적 판정.
// 사용자 문구는 계약서 §8 원문. 원시 Postgres/Supabase 메시지는 노출하지 않는다.
const E_NOT_FOUND = '초대를 찾을 수 없습니다.'
const E_UNUSABLE = '만료되었거나 사용할 수 없는 초대입니다.'
const E_LOOKUP = '초대를 확인할 수 없어 중단했습니다.'
const E_JOIN_FAILED = '합류 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
const E_JOIN_STUCK = '합류 처리에 실패했습니다. 관리자에게 문의해 주세요.'
const E_SIGNUP_FAILED = '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'

interface InviteRowRaw {
  project_id: string
  team_id: string
  email: string
  created_by: string | null
  expires_at: string
  revoked_at: string | null
  redeemed_at: string | null
}
const INVITE_COLS = 'project_id, team_id, email, created_by, expires_at, revoked_at, redeemed_at'

/** consume_project_invite 의 반환 컬럼(0065). */
interface ConsumedInvite {
  project_id: string
  team_id: string
  invite_email: string
  created_by: string | null
}

/**
 * 토큰으로 초대 1행. 조회 실패(E17)와 미존재(E1)를 구분한다 —
 * 조회 실패를 '없음'으로 위장하면 DB 장애가 곧 '만료된 링크' 안내가 된다.
 */
async function loadInvite<T>(
  admin: AdminClient, token: string, cols: string = INVITE_COLS,
): Promise<{ ok: true; invite: T } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('project_invites').select(cols).eq('token', token).maybeSingle()
  if (error) {
    // 토큰은 로그에 남기지 않는다.
    console.error('[inviteRedeem] 초대 조회 실패:', error.message)
    return { ok: false, error: E_LOOKUP }
  }
  if (!data) return { ok: false, error: E_NOT_FOUND }
  return { ok: true, invite: data as unknown as T }
}

/** 세션 조회 실패를 '비로그인'으로 폴백하지 않는다 — 이 판정이 합류 허용 여부를 가른다(fail-closed). */
async function currentUser(): Promise<
  { ok: true; user: Awaited<ReturnType<typeof getSession>> } | { ok: false; error: string }
> {
  try {
    return { ok: true, user: await getSession() }
  } catch (e) {
    console.error('[inviteRedeem] 세션 확인 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: E_LOOKUP }
  }
}

/** 검증과 소비를 단일 UPDATE 로 처리하는 RPC. 이메일 일치도 DB 가 강제한다(설계 P1). */
async function consumeInvite(
  admin: AdminClient, token: string, email: string, userId: string,
): Promise<{ ok: true; row: ConsumedInvite } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('consume_project_invite', {
    p_token: token, p_email: email, p_user: userId,
  })
  if (error) {
    console.error('[inviteRedeem] 초대 소비 실패:', error.message)
    return { ok: false, error: E_LOOKUP }
  }
  const rows = (data ?? []) as ConsumedInvite[]
  // 0행 = 만료·취소·이미 사용·이메일 불일치. 어느 쪽인지 알려주지 않는다(초대 존재 탐침 차단).
  if (rows.length === 0) return { ok: false, error: E_UNUSABLE }
  return { ok: true, row: rows[0] }
}

/**
 * 합류 역할 부여. **`ignoreDuplicates` 를 빼면 UPDATE 가 되어** 이미 admin 인 사용자가
 * 자기 프로젝트의 초대 링크를 밟는 순간 member 로 강등된다.
 */
async function grantMemberRole(
  admin: AdminClient, projectId: string, userId: string, grantedBy: string,
): Promise<boolean> {
  const { error } = await admin.from('project_roles').upsert(
    { project_id: projectId, user_id: userId, role: 'member', granted_by: grantedBy },
    { onConflict: 'project_id,user_id', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[inviteRedeem] 역할 부여 실패:', error.message)
    return false
  }
  return true
}

/**
 * 소비를 되돌린다. 1회용 초대라 소비만 되고 역할이 안 붙으면 재시도가 원리적으로 불가능하다 —
 * 되돌려야 같은 링크를 다시 쓸 수 있다. 되돌리기까지 실패하면 링크가 '사용됨'으로 고착되므로
 * 사용자에게는 관리자 문의를 안내한다(E_JOIN_STUCK).
 */
async function revertRedeem(admin: AdminClient, token: string): Promise<boolean> {
  const { error } = await admin
    .from('project_invites').update({ redeemed_by: null, redeemed_at: null }).eq('token', token)
  if (error) {
    console.error('[inviteRedeem] 소비 되돌리기 실패 — 초대가 사용됨으로 고착:', error.message)
    return false
  }
  return true
}

/**
 * 가입 경로 보상 롤백. 계정을 지우면 memberships·project_roles 는 FK cascade 로 함께 사라진다.
 *
 * 이미 소비한 초대가 있으면 **계정 삭제보다 먼저** 되돌린다 — 되돌려야 1회용 링크가 활성으로
 * 돌아와 사용자가 같은 메일로 재시도할 수 있다. 순서가 중요한 이유는 그것뿐이다(0065 의
 * redeem 쌍 CHECK 는 한 방향만 금지하므로 (null, timestamp) 를 허용한다 — 삭제가 막히지 않는다).
 *
 * 되돌리기가 실패해도 계정 삭제는 그대로 진행한다. 초대는 '사용됨'으로 고착되어 관리자가 다시
 * 발급해야 하지만, 유령 계정을 남기는 쪽이 더 나쁘다 — 그 계정은 전사 읽기 권한을 갖는다.
 */
async function rollbackSignup(
  admin: AdminClient, userId: string, consumedToken: string | null,
): Promise<void> {
  // 토큰 전문은 로그에 남기지 않는다. 고착된 초대는 redeemed_by 로 특정한다.
  if (consumedToken && !(await revertRedeem(admin, consumedToken))) {
    console.error(
      `[inviteRedeem] 초대가 사용됨으로 고착 — 재발급 필요(redeemed_by=${userId} 로 조회)`,
    )
  }
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`[inviteRedeem] 보상 롤백 실패(유령 계정 잔존 user_id=${userId}):`, error.message)
  }
}

/**
 * 팀 소속 보정. 기존 계정의 소속을 초대가 덮어쓰지 않는 것은 의도다 — 팀은 관리자가 정하는
 * 값이고 초대는 프로젝트 합류를 위한 것이다. 다만 `memberships` 행이 **아예 없는** 계정은
 * 팀이 비어 WBS 담당 판정이 깨지므로, 그 경우에만 초대의 팀으로 채운다.
 *
 * 여기까지 왔으면 초대는 이미 소비됐고 역할도 붙었다 — 실패해도 합류를 되돌리지 않고 흔적만
 * 남긴다. 선행 조회가 깨졌으면 쓰지 않는다(있는 소속을 덮어쓰는 쪽이 더 위험하다).
 */
async function ensureMembership(admin: AdminClient, userId: string, teamId: string): Promise<void> {
  const { data, error } = await admin
    .from('memberships').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) {
    console.error('[redeemInvite] 멤버십 확인 실패 — 팀 보정을 생략한다:', error.message)
    return
  }
  if (data) return
  // memberships.role 은 deprecated(0054)이나 not null — 옛 값 하나를 채운다(accounts.ts 관례).
  const { error: insErr } = await admin.from('memberships')
    .insert({ user_id: userId, team_id: teamId, role: 'team_editor' })
  if (insErr) console.error('[redeemInvite] 멤버십 보정 저장 실패:', insErr.message)
}

export interface InvitePreview {
  projectName: string
  projectDescription: string | null
  /** 전체 주소는 노출하지 않는다 — 링크만 주운 사람에게 수신자를 알려주지 않기 위해. */
  maskedEmail: string
  status: InviteStatus
  /** 가입 폼 / 로그인 폼 분기용. */
  accountExists: boolean
}

interface PreviewRowRaw {
  email: string
  expires_at: string
  revoked_at: string | null
  redeemed_at: string | null
  projects: { name: string; description: string | null } | null
}

export async function getInvitePreview(
  token: string,
): Promise<{ ok: true; preview: InvitePreview } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const admin = createAdminClient()
  // 반환 컬럼 화이트리스트 — projects 는 name/description 만(share 페이지 선례).
  const found = await loadInvite<PreviewRowRaw>(
    admin, token, 'email, expires_at, revoked_at, redeemed_at, projects(name, description)',
  )
  if (!found.ok) return found
  const row = found.invite
  const status = inviteStatus(
    { expiresAt: row.expires_at, revokedAt: row.revoked_at, redeemedAt: row.redeemed_at },
    new Date(),
  )
  // 비활성 초대는 **상태만** 돌려준다. 이미 소비·취소·만료된 링크가 유출됐을 때 프로젝트명·
  // 수신자·계정 유무까지 딸려 나갈 이유가 없다. 화면도 이 상태에서는 안내 문구만 쓴다.
  // 부수 효과로 계정 목록 전량 조회도 건너뛴다 — 의도한 것이다.
  if (status !== 'active') {
    return {
      ok: true,
      preview: {
        projectName: '', projectDescription: null, maskedEmail: '', status, accountExists: false,
      },
    }
  }
  const project = row.projects as unknown as { name: string; description: string | null } | null

  // 계정 유무는 폼 분기에만 쓰지만, 조회가 깨졌는데 '계정 없음'으로 폴백하면
  // 기존 사용자에게 가입 폼을 보여 주고 제출 뒤에야 실패한다. 여기서 중단한다.
  let accountExists: boolean
  try {
    const users = await listAllAuthUsers(admin)
    const target = normalizeInviteEmail(row.email)
    accountExists = users.some((u) => normalizeInviteEmail(u.email) === target)
  } catch (e) {
    console.error('[inviteRedeem] 계정 목록 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: E_LOOKUP }
  }

  return {
    ok: true,
    preview: {
      projectName: project?.name ?? '',
      projectDescription: project?.description ?? null,
      maskedEmail: maskEmail(row.email),
      status,
      accountExists,
    },
  }
}

/**
 * 초대 화면 분기용 세션 상태. 세션이 있는 사람에게만 일치 여부를 알려준다.
 *
 * 마스킹 문자열끼리 비교하면 앞 2자와 길이만 남으므로 `hong.gd@`와 `hong.gs@`가 같은 값이 된다
 * — 사내 `이름.이니셜@` 관례에서 흔한 충돌이라 화면이 엉뚱한 폼을 띄운다. 판정은 서버가
 * 정규화된 원문끼리 하고 결과 불리언만 내려보낸다. 해시도 내려보내지 않는다(사내 주소 공간이
 * 작아 역산된다).
 */
export async function getInviteSessionState(
  token: string,
): Promise<{ ok: true; authed: boolean; emailMatches: boolean } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  // 비로그인 호출자에게는 초대 이메일에 관한 어떤 정보도 주지 않는다 — 조회조차 하지 않는다.
  if (!s.user) return { ok: true, authed: false, emailMatches: false }

  const admin = createAdminClient()
  const found = await loadInvite<{ email: string }>(admin, token, 'email')
  if (!found.ok) return found
  const sessionEmail = normalizeInviteEmail(s.user.email ?? '')
  return {
    ok: true,
    authed: true,
    emailMatches: sessionEmail !== '' && sessionEmail === normalizeInviteEmail(found.invite.email),
  }
}

/** 로그인 사용자 합류. 세션 이메일이 초대 이메일과 다르면 소비 전에 거부한다. */
export async function redeemInvite(
  token: string,
): Promise<{ ok: true; projectId: string; alreadyMember: boolean } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  if (!s.user) return { ok: false, error: '로그인이 필요합니다.' }
  const user = s.user

  const admin = createAdminClient()
  const found = await loadInvite<InviteRowRaw>(admin, token)
  if (!found.ok) return found
  const invite = found.invite

  const sessionEmail = normalizeInviteEmail(user.email ?? '')
  if (!sessionEmail || sessionEmail !== normalizeInviteEmail(invite.email)) {
    return { ok: false, error: '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.' }
  }

  // 이미 역할이 있으면 초대를 태우지 않는다 — 1회용이라 태워봐야 되돌릴 일만 생긴다.
  // 선행 조회 실패는 중단(에러 처리 3원칙): 없다고 보고 진행하면 소비만 하고 끝날 수 있다.
  const { data: existing, error: roleErr } = await admin
    .from('project_roles').select('user_id')
    .eq('project_id', invite.project_id).eq('user_id', user.id).maybeSingle()
  if (roleErr) {
    console.error('[redeemInvite] 기존 역할 조회 실패:', roleErr.message)
    return { ok: false, error: E_LOOKUP }
  }
  if (existing) return { ok: true, projectId: invite.project_id, alreadyMember: true }

  const consumed = await consumeInvite(admin, token, sessionEmail, user.id)
  if (!consumed.ok) return consumed

  // granted_by 는 초대를 만든 관리자 — 사고 추적의 출발점이다(생성자가 삭제됐으면 본인).
  const granted = await grantMemberRole(
    admin, consumed.row.project_id, user.id, consumed.row.created_by ?? user.id,
  )
  if (!granted) {
    const reverted = await revertRedeem(admin, token)
    return { ok: false, error: reverted ? E_JOIN_FAILED : E_JOIN_STUCK }
  }

  // 초대의 team_id 로 기존 계정의 소속을 덮어쓰지 않는다(의도) — 없을 때만 채운다.
  await ensureMembership(admin, user.id, consumed.row.team_id)

  revalidatePath('/projects')
  return { ok: true, projectId: consumed.row.project_id, alreadyMember: false }
}

/**
 * 가입 + 합류. **이메일을 인자로 받지 않는다** — 서버가 초대 행의 이메일로만 계정을 만든다.
 * 클라이언트가 주소를 정할 수 있으면 링크 하나로 아무 계정이나 만들 수 있게 된다(설계 P1).
 */
export async function redeemInviteWithSignup(
  token: string, input: SignupInput,
): Promise<{ ok: true; projectId: string; email: string } | { ok: false; error: string }> {
  if (!isInviteToken(token)) return { ok: false, error: E_NOT_FOUND }
  const s = await currentUser()
  if (!s.ok) return { ok: false, error: s.error }
  if (s.user) return { ok: false, error: '이미 로그인되어 있습니다.' }

  const valid = validateSignupInput(input)
  if (!valid.ok) return { ok: false, error: valid.error }

  const admin = createAdminClient()
  const found = await loadInvite<InviteRowRaw>(admin, token)
  if (!found.ok) return found
  const invite = found.invite
  // 계정을 만들기 전에 한 번 거른다. 진짜 판정은 아래 소비 RPC 가 원자적으로 한다.
  const status = inviteStatus(
    { expiresAt: invite.expires_at, revokedAt: invite.revoked_at, redeemedAt: invite.redeemed_at },
    new Date(),
  )
  if (status !== 'active') return { ok: false, error: E_UNUSABLE }

  const email = normalizeInviteEmail(invite.email)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // SMTP 없이 즉시 로그인 가능하도록 확인 처리(accounts.ts 관례)
    user_metadata: { full_name: input.name.trim() },
  })
  if (createErr || !created?.user) {
    // 원인을 구분해 주면 '이 주소에 계정이 있는가'를 되묻는 탐침이 된다.
    return { ok: false, error: '이미 가입된 계정이거나 입력값을 확인해 주세요.' }
  }
  const userId = created.user.id

  // memberships.role 은 deprecated(0054)이나 not null — 옛 값 하나를 채운다(accounts.ts 와 동일).
  const { error: memErr } = await admin.from('memberships')
    .insert({ user_id: userId, team_id: invite.team_id, role: 'team_editor' })
  if (memErr) {
    console.error('[redeemInviteWithSignup] 멤버십 저장 실패:', memErr.message)
    await rollbackSignup(admin, userId, null)
    return { ok: false, error: E_SIGNUP_FAILED }
  }

  const consumed = await consumeInvite(admin, token, email, userId)
  if (!consumed.ok) {
    // 소비 실패 = 이 계정이 존재할 근거가 없다. 유령 계정을 남기지 않는다.
    // 토큰을 함께 넘긴다 — RPC 가 실제로는 커밋됐는데 응답만 깨진 경우 행은 소비된 상태라
    // 되돌리지 않으면 1회용 링크가 아무도 쓰지 못한 채 타 버린다. 소비되지 않은 경우엔
    // where token=? 업데이트가 null 을 다시 null 로 쓸 뿐이라 무해하다(멱등 no-op).
    await rollbackSignup(admin, userId, token)
    return consumed
  }

  const granted = await grantMemberRole(
    admin, consumed.row.project_id, userId, consumed.row.created_by ?? userId,
  )
  if (!granted) {
    await rollbackSignup(admin, userId, token)
    return { ok: false, error: E_SIGNUP_FAILED }
  }

  // 같은 이메일의 프로젝트 멤버 행에 새 계정을 잇는다(accounts.ts 선례).
  // 이메일이 관리자가 지정한 값이라 로스터를 가로챌 여지는 없다. 실패해도 가입은 성공으로 둔다.
  const { error: linkErr } = await admin.from('project_members')
    .update({ user_id: userId }).is('user_id', null).eq('email', email)
  if (linkErr) console.error('[redeemInviteWithSignup] 멤버 행 연결 실패:', linkErr.message)

  revalidatePath('/projects')
  return { ok: true, projectId: consumed.row.project_id, email }
}
