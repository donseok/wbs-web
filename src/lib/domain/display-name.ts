/**
 * 로그인 계정의 표시 이름. 계정 생성(actions/accounts.ts)은 user_metadata.full_name 에
 * 쓰므로 full_name 이 1차, name 은 OAuth 프로바이더 관례를 위한 폴백, 마지막은 이메일 아이디.
 * 헤더(lib/auth.ts)와 회의 작성자명(actions/meetings.ts)이 같은 규칙을 쓰도록 여기로 모은다.
 */
export function displayNameFrom(
  metadata: Record<string, unknown> | null | undefined,
  email: string | null | undefined,
): string | null {
  const pick = (key: string): string => {
    const v = metadata?.[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  return pick('full_name') || pick('name') || email?.split('@')[0]?.trim() || null
}
