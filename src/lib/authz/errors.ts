/**
 * 가드 실패 사유 문자열과 그 HTTP 매핑 — 순수 모듈.
 *
 * index.ts(가드)가 아니라 여기 사는 이유: index.ts 는 테스트에서 통째로 vi.mock 되는 모듈이고
 * (가드 몇 개만 스텁하는 테스트가 37개) 라우트가 거기서 denyStatus 를 가져오면 모킹된 문맥에서
 * export 누락으로 터진다 — 실제로 이 배치로 라우트 테스트가 깨졌다.
 * 문자열과 매핑은 I/O 가 없으니 분리해 둔다.
 */

export const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
export const ERR_DENIED = '권한 없음'
export const ERR_ANON = '로그인 필요'
export const ERR_MISSING = '대상을 찾을 수 없습니다.'

/**
 * 가드 에러 문자열 → HTTP status. 문자열 정본이 이 파일이므로 매핑도 같이 산다
 * (라우트별 사본은 문자열이 바뀌면 조용히 전부 fallback 으로 떨어진다).
 * 비로그인 401 · 권한 없음 403 · 그 외(권한 조회 실패 등)는 호출부가 고른 fallback.
 * wiki/reindex 는 503(판정 불가)을, 나머지 라우트는 500(서버 문제)을 택했다.
 */
export function denyStatus(error: string, fallback: number = 500): number {
  if (error === ERR_ANON) return 401
  if (error === ERR_DENIED) return 403
  return fallback
}
