import type { Actor } from '@/lib/domain/authz'

/**
 * 사용 현황(/usage) 열람 권한 — 판정을 여기 한 곳에만 둔다.
 *
 * 슈퍼유저 전용(2026-07-30 사용자 결정). 접속 로그·계정별 사용량은 전 직원의
 * 행동 데이터라 프로젝트 관리자에게도 열지 않는다.
 *
 * DB 쪽 대응물은 0053 의 read_usage_events 정책(is_superuser()) — 바꿀 때 두 군데를 같이 본다.
 */
export function canViewUsage(actor: Actor | null): boolean {
  return actor?.isSuperuser === true
}
