import type { AdminClient } from '@/lib/minutes/externalApi'

/**
 * 로스터 다리 이중 매칭(§2.5-④) — user_id 링크(0019 트리거) 또는 email 소문자 일치.
 * scope=assigned·claim 배정 제한이 공유하는 "이게 내 배정인지" 판정 재료.
 * 조회 실패는 위장하지 않고 throw — 배정 판정은 보안 재료라 "빈 결과"로 삼키면 사칭을 못 잡는다.
 */
export async function myMemberIds(
  admin: AdminClient,
  args: { userId: string; userEmail: string; projectId: string },
): Promise<string[]> {
  const { data, error } = await admin
    .from('project_members').select('id, user_id, email').eq('project_id', args.projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const email = args.userEmail.toLowerCase()
  const out = new Set<string>()
  for (const m of (data ?? []) as Array<{ id: string; user_id: string | null; email: string | null }>) {
    if (m.user_id === args.userId || (m.email && m.email.toLowerCase() === email)) out.add(m.id)
  }
  return [...out]
}

type AncestorRow = { id: string; parent_id: string | null; assignee_member_id: string | null; stub_for: string | null }

/**
 * 서브트리 관리자 판정(트랙 B, 2026-09-15) — 대상 항목의 **strict 조상**(부모·조부모…루트,
 * 자신 제외) 중 어느 노드의 assignee_member_id 가 myMemberIds 와 교집합이 있으면 true.
 * strict 조상은 정의상 전부 비리프이므로 "비리프 담당자" 조건은 이 정의로 자동 충족된다 —
 * 대상 리프 자신의 담당자는 여기서 절대 보지 않는다(자기 완료를 자기가 승인하는 경로를 막는
 * 분리 원칙은 이 함수가 아니라 호출부가 requireDelegationRight 와 따로 조합해 지킨다).
 *
 * 한 번의 왕복으로 프로젝트 전체 wbs_items(id, parent_id, assignee_member_id)를 읽고 메모리에서
 * parent_id 체인을 루트까지 걷는다. with recursive CTE 를 안 쓰는 이유: supabase-js(PostgREST)
 * 는 raw SQL 실행 경로가 없어 CTE 는 DB 함수(RPC)가 있어야 하는데 그건 마이그레이션이고 이번
 * 범위는 마이그레이션 금지다. 대신 이 프로젝트에 이미 있는 관례(setWbsAssigneeCascade,
 * wbsAssign.ts — 하위 트리를 이 방식으로 한 번에 읽어 메모리에서 순회)를 조상 방향으로 그대로
 * 쓴다. project_id 로 필터하므로 프로젝트 경계 확인도 이 한 조회가 겸하고, visited Set 으로
 * parent_id 순환(데이터 오류)에도 무한루프 없이 종료한다.
 *
 * 조회 실패는 위장하지 않고 throw — 호출부가 fail-closed 로 거부해야 한다(myMemberIds 와 동일 계약).
 */
export async function isSubtreeManager(
  admin: AdminClient,
  args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<boolean> {
  if (args.myMemberIds.length === 0) return false
  const { data, error } = await admin
    .from('wbs_items').select('id, parent_id, assignee_member_id, stub_for').eq('project_id', args.projectId)
  if (error) throw new Error(`조상 조회 실패: ${error.message}`)
  const byId = new Map(((data ?? []) as AncestorRow[]).map(r => [r.id, r]))
  const mine = new Set(args.myMemberIds)
  const visited = new Set<string>()
  const start = byId.get(args.itemId)
  let cur = start?.parent_id ?? null
  if (start?.stub_for && cur !== null) cur = byId.get(cur)?.parent_id ?? null // 스펙 F15 — isSubtreeManagerOf 와 같은 규칙
  while (cur !== null && !visited.has(cur)) {
    visited.add(cur)
    const row = byId.get(cur)
    if (!row) break // parent_id 가 이 프로젝트 조회 결과 밖 — 데이터 이상, 더 올라가지 않는다(fail-closed 방향).
    if (row.assignee_member_id && mine.has(row.assignee_member_id)) return true
    cur = row.parent_id
  }
  return false
}
