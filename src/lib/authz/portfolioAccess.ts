import type { Actor } from '@/lib/domain/authz'

/**
 * 전사 포트폴리오(/portfolio) 열람 권한 — 판정을 여기 한 곳에만 둔다(canViewUsage 관례).
 *
 * 슈퍼유저 전용(2026-08-18 사용자 결정). 전 프로젝트(비공개 0070 포함)의 진척·신호를
 * 한 화면에 모으므로 프로젝트 관리자에게도 열지 않는다.
 *
 * projects/wbs_items 읽기 RLS 는 전 직원 개방(0002)이라 DB 2차 방어선이 없다 —
 * 이 코드 게이트(+사이드바 어포던스)가 유일한 관문이다.
 */
export function canViewPortfolio(actor: Actor | null): boolean {
  return actor?.isSuperuser === true
}
