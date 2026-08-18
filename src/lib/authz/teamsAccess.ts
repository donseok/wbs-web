import type { Actor } from '@/lib/domain/authz'

/**
 * 팀 기준정보 관리(/admin/teams) 권한 — 판정을 여기 한 곳에만 둔다(canViewUsage 관례).
 *
 * 슈퍼유저 전용(스펙 §5). 팀 마스터는 서버 전역 기준정보라 — 탭·필터·검증·엑셀·회의록 편철이
 * 전부 이 목록을 따른다 — 프로젝트 관리자에게도 열지 않는다.
 *
 * 페이지 게이트와 헤더 어포던스(HeaderChrome 메뉴)가 같은 판정을 쓴다 — 어포던스가
 * 독자 판정을 하면 링크는 보이는데 페이지는 거부되는(또는 그 반대) 드리프트가 생긴다.
 * HeaderChrome 은 직렬화된 HeaderIdentity 를 들고 있어 시그니처는 최소 형태로 받는다.
 */
export function canManageTeams(actor: Pick<Actor, 'isSuperuser'> | null): boolean {
  return actor?.isSuperuser === true
}
