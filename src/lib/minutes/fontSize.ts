/** 회의록 본문 글자크기(px) — 뷰어 컨트롤과 저장 계층이 공유하는 단일 계약(스펙 §4.1). */
export const MINUTE_FS_MIN = 12
export const MINUTE_FS_MAX = 28
export const MINUTE_FS_DEFAULT = 14
export const MINUTE_FS_STEP = 1

/** 로그인 뷰어·공유 뷰어가 공유하는 localStorage 키(서버값이 있으면 서버값이 우선). */
export const MINUTE_FS_STORAGE_KEY = 'dflow-minute-fs'

/**
 * 어떤 입력이든 유효한 px 값으로 정규화한다.
 * 서버 prefs(JSONB)·localStorage 는 타입 보장이 없어 문자열·NaN·범위 밖 값이 올 수 있고,
 * 그대로 CSS 변수에 흘리면 레이아웃이 깨진다 — 여기서 전부 흡수한다.
 */
export function clampMinuteFontSize(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return MINUTE_FS_DEFAULT
  const rounded = Math.round(n)
  if (rounded < MINUTE_FS_MIN) return MINUTE_FS_MIN
  if (rounded > MINUTE_FS_MAX) return MINUTE_FS_MAX
  return rounded
}

/** 현재값에서 한 단계 이동(경계에서 멈춤). 오염된 현재값도 clamp 후 계산한다. */
export function stepMinuteFontSize(cur: unknown, dir: 1 | -1): number {
  return clampMinuteFontSize(clampMinuteFontSize(cur) + dir * MINUTE_FS_STEP)
}
