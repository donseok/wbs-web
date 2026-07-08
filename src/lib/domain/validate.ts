// 공용 입력 검증 유틸 — 클라이언트/서버 양쪽에서 동일 규칙을 쓰기 위한 순수 함수.

/** 이메일 형식 검증. 공백·@·도메인 최소 형태만 확인(과도한 엄격 규칙은 지양). */
export function isValidEmail(email: string): boolean {
  const t = email.trim()
  if (!t) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)
}

/**
 * 'YYYY-MM-DD' 형식 + 달력에 실재하는 날짜인지 (2026-02-30 등 반려).
 * isValidDateRange 는 형식만 보므로 실재성 검사가 필요하면 이쪽을 쓴다.
 */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * 시작일~종료일 범위 검증. null/빈문자열은 "미입력"으로 간주해 통과.
 * 둘 다 있으면 YYYY-MM-DD 형식 확인 후 시작 <= 종료(하루짜리 프로젝트 허용).
 */
export function isValidDateRange(start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(start) || !re.test(end)) return false
  return start <= end
}
