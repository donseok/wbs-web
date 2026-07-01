// 공용 입력 검증 유틸 — 클라이언트/서버 양쪽에서 동일 규칙을 쓰기 위한 순수 함수.

/** 이메일 형식 검증. 공백·@·도메인 최소 형태만 확인(과도한 엄격 규칙은 지양). */
export function isValidEmail(email: string): boolean {
  const t = email.trim()
  if (!t) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}
