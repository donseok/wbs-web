import type { Membership } from '@/lib/domain/types'

/**
 * 사용 현황(/usage) 열람 권한 — 판정을 여기 한 곳에만 둔다.
 *
 * 현재는 전원 공개다(요구사항: "지금 구현 단계에서는 일단 다 볼 수 있게").
 * 관리자 전용으로 전환할 때 바꿀 곳은 이 함수와 0051 의 read_usage_events 정책,
 * 두 군데뿐이다.
 *
 * 주의: 전환 시 `m?.role === 'pmo_admin'` 으로 두면 실질적 관리자 전용이 아니다 —
 * 2026-07-30 기준 41계정 중 28명(68%)이 pmo_admin 이다. 진행 중인 권한 3단
 * 재설계(is_superuser)가 들어온 뒤 그 축에 거는 것을 전제로 한다.
 */
// 인자를 지금 안 쓴다고 지우면, 잠글 때 모든 호출부의 시그니처를 함께 고쳐야 한다.
// 호출부는 이미 멤버십을 넘기고 있으므로 전환은 이 함수 본문 한 줄 교체로 끝난다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function canViewUsage(_m: Membership | null): boolean {
  return true
}
