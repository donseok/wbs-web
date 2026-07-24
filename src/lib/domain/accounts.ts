// 계정(auth.users + memberships) 관련 순수 함수 — 클라이언트/서버 공용, 부수효과 없음.
import { isValidEmail } from '@/lib/domain/validate'
import type { TeamCode } from '@/lib/domain/types'

/** 로그인 계정 권한 (memberships.role 화이트리스트). project_members.role 과 다르다. */
export const ACCOUNT_ROLES = ['pmo_admin', 'team_editor'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

/** 팀 코드 검증 — 허용 목록은 호출처가 팀 마스터(활성 팀)에서 주입한다. */
export function isTeamCode(v: string, codes: readonly string[]): v is TeamCode {
  return codes.includes(v)
}
export function isAccountRole(v: string): v is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(v)
}

/** 비밀번호 정책 — 최소 8자(Supabase 기본 정책과 정합). */
export function isValidPassword(pw: unknown): boolean {
  return typeof pw === 'string' && pw.length >= 8
}

/** 일괄 등록 한 줄의 파싱 결과. ok=false 이면 error 에 사유. */
export interface ParsedAccountLine {
  lineNo: number          // 파일 기준 1-base 행번호(빈 줄 포함해 계산)
  raw: string
  ok: boolean
  email?: string
  teamCode?: TeamCode
  role?: AccountRole
  password?: string
  name?: string | null
  error?: string
}

/**
 * 일괄 붙여넣기 텍스트를 행 단위로 파싱·검증한다.
 * 형식: 고정 4열 `이메일, 팀코드, 권한, 초기비번` + 선택 5열 `이름`.
 * 구분자는 콤마 또는 탭(엑셀 붙여넣기 대응). 빈 줄은 결과에서 제외한다.
 * 주의: 초기비번에는 콤마·탭을 쓸 수 없다(구분자로 해석됨).
 */
export function parseBulkAccounts(text: string, teamCodes: readonly string[]): ParsedAccountLine[] {
  const out: ParsedAccountLine[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const trimmed = raw.trim()
    if (!trimmed) return // 빈 줄 제외
    const lineNo = i + 1
    const cols = trimmed.split(/\s*[,\t]\s*/)
    const [email, teamCode, role, password, name] = cols
    if (cols.length < 4) {
      out.push({ lineNo, raw: trimmed, ok: false, error: '열 부족 — 이메일, 팀, 권한, 초기비번이 필요합니다.' })
      return
    }
    if (!isValidEmail(email)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '이메일 형식 오류' })
      return
    }
    if (!isTeamCode(teamCode, teamCodes)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 팀: ${teamCode}` })
      return
    }
    if (!isAccountRole(role)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 권한: ${role}` })
      return
    }
    if (!isValidPassword(password)) {
      out.push({ lineNo, raw: trimmed, ok: false, email, error: '비밀번호는 8자 이상이어야 합니다.' })
      return
    }
    out.push({
      lineNo, raw: trimmed, ok: true,
      email: email.trim(), teamCode, role, password,
      name: name?.trim() || null,
    })
  })
  return out
}
