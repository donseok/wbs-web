import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { emitNotification } from '@/lib/notify/emit'

/**
 * WBS 업로드(export JSON → upsert) 변환·후처리 — 계약 v2.0 §2.6.
 * 순수부(parseSchedule·assembleSpecMarkdown·toRpcNode)와 DB부(applyAssigneesAndOrders)를 분리한다.
 * 라우트(src/app/api/v1/wbs/import/route.ts)는 얇게 — 이 모듈이 규칙을 쥔다.
 */
export type SpecSections = {
  requirements: string[]; test_criteria: string[]; constraints: string[]
  api_spec: string | null; data_model: string | null; description: string | null
}
export type ImportNode = {
  id: string; parent_id: string | null; kind: 'phase' | 'act' | 'wp' | 'task'
  title: string; stage: string | null; category: string | null; domain: string | null
  assignee: string | null; schedule: string | null
  depends: string[]; acceptance: string[]
  priority: string | null // 라벨: critical/high/medium/low (계약 v2 — 결정 E)
  model: string | null; tags: string[]
  prd_ref: string | null; entry_point: string | null
  spec_sections: SpecSections | null
}
const STAGES = new Set(['as', 'fp', 'ip', 'im', 'xx'])
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])
const SCHEDULE_RE = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/

export function parseSchedule(s: string | null): { start: string | null; end: string | null } | { error: string } {
  if (!s) return { start: null, end: null }
  const m = SCHEDULE_RE.exec(s.trim())
  if (!m) return { error: `schedule 형식 오류: ${s}` }
  return { start: m[1], end: m[2] }
}

/** spec_sections → 마크다운 조립 — 섹션 순서는 계약 고정(결정 E): 머리말 → 요구사항 → 제약 → 테스트 기준 → API 스펙 → 데이터 모델. 빈 섹션 생략. */
export function assembleSpecMarkdown(s: SpecSections | null): string | null {
  if (!s) return null
  const parts: string[] = []
  if (s.description) parts.push(s.description.trim())
  const list = (title: string, items: string[]) => {
    if (items.length > 0) parts.push(`## ${title}\n${items.map(i => `- ${i}`).join('\n')}`)
  }
  list('요구사항', s.requirements ?? [])
  list('제약', s.constraints ?? [])
  list('테스트 기준', s.test_criteria ?? [])
  if (s.api_spec) parts.push(`## API 스펙\n${s.api_spec.trim()}`)
  if (s.data_model) parts.push(`## 데이터 모델\n${s.data_model.trim()}`)
  return parts.length > 0 ? parts.join('\n\n') : null
}

export function toRpcNode(module: string, n: ImportNode, index: number):
  | { external_ref: string; parent_external_ref: string | null; title: string
      stage: string | null; planned_start: string | null; planned_end: string | null
      sort_order: number; assignee: string | null
      category: string | null; domain: string | null; priority: string | null
      model: string | null; tags: string[]; depends: string[]
      prd_ref: string | null; entry_point: string | null
      acceptance: string[]; spec: string | null; dev_workflow: boolean }
  | { error: string } {
  if (!n.id || !n.title) return { error: `id·title 필수: ${JSON.stringify(n.id)}` }
  // v2.1: 'todo' 는 stage 축에서 제거됐다(0079) — 검증 전에 null 로 정규화해 하위호환 수용.
  const stage = n.stage === 'todo' ? null : n.stage
  if (stage !== null && stage !== undefined && !STAGES.has(stage)) return { error: `허용 밖 stage: ${stage} (${n.id})` }
  if (n.priority !== null && n.priority !== undefined && !PRIORITY_LABELS.has(n.priority)) {
    return { error: `허용 밖 priority 라벨: ${n.priority} (${n.id})` }
  }
  const sched = parseSchedule(n.schedule)
  if ('error' in sched) return { error: `${sched.error} (${n.id})` }
  return {
    external_ref: `${module}/${n.id}`,
    parent_external_ref: n.parent_id ? `${module}/${n.parent_id}` : null,
    title: n.title, stage: stage ?? null,
    planned_start: sched.start, planned_end: sched.end,
    sort_order: index, // 파일 내 등장 순서가 정렬 정본 — priority 는 정렬이 아니라 라벨(결정 E)
    assignee: n.assignee ? n.assignee.trim().toLowerCase() : null,
    category: n.category ?? null, domain: n.domain ?? null, priority: n.priority ?? null,
    model: n.model ?? null, tags: n.tags ?? [],
    depends: (n.depends ?? []).map(d => `${module}/${d}`), // 선행도 external_ref 로 저장(결정 C 게이트 키)
    prd_ref: n.prd_ref ?? null, entry_point: n.entry_point ?? null,
    acceptance: n.acceptance ?? [], spec: assembleSpecMarkdown(n.spec_sections),
    dev_workflow: n.kind === 'task', // v2.1: 도입 여부는 kind 로 자동 결정 — wp/act/phase 는 항상 false
  }
}

/**
 * 업로드 후처리 — 신규 리프의 assignee email 을 로스터에 매칭하고 자동 발행까지(§2.6·§2.8).
 * v2.1: 주문 보장은 더 이상 "assignee 있는 신규 ref"가 아니라 "kind='task' 인 모든 신규 ref" 대상이다
 * (배정은 조건이 아니다 — dev_workflow 는 RPC 가 이미 심었고, 리프·활성주문 게이트는 ensureOrderForWorkflowLeaf 내부 판정).
 * assignee 매칭(email→member, unmatched 리포트, work.assigned 알림)은 종전대로 assignee 있는 것만 대상.
 */
export async function applyAssigneesAndOrders(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string; module: string
    newRefs: string[]; idsByRef: Record<string, string>
    assigneeByRef: Record<string, string | null>; titleByRef: Record<string, string>
    kindByRef: Record<string, string> },
): Promise<{ unmatched: Array<{ id: string; assignee: string }>; ordersCreated: number; nonLeafSkipped: string[] }> {
  const { projectId, actorUserId, module } = args
  const unmatched: Array<{ id: string; assignee: string }> = []
  const nonLeafSkipped: string[] = []
  let ordersCreated = 0
  // 로스터 email → member_id 맵 1회 로드
  const { data: members, error } = await admin
    .from('project_members').select('id, email').eq('project_id', projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const memberByEmail = new Map<string, string>()
  for (const m of (members ?? []) as Array<{ id: string; email: string | null }>) {
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m.id)
  }
  for (const ref of args.newRefs) {
    const itemId = args.idsByRef[ref]
    if (!itemId) continue

    const email = args.assigneeByRef[ref]
    if (email) {
      const memberId = memberByEmail.get(email)
      if (!memberId) {
        // 계약(api-contract.md §2.6): 클라이언트는 bare id만 안다 — external_ref 조합은 서버 책임이므로
        // 응답도 bare id로 되돌린다(module 프리픽스 + "/" 제거).
        unmatched.push({ id: ref.slice(module.length + 1), assignee: email }) // 생략하지 않고 전량 리포트
      } else {
        const { error: upErr } = await admin
          .from('wbs_items').update({ assignee_member_id: memberId }).eq('id', itemId)
        if (upErr) throw new Error(`담당자 반영 실패(${ref}): ${upErr.message}`)
        // 담당자 매칭 알림 — fire-and-forget(본 로직 실패로 이어지지 않음). 재업로드 멱등은 dedupeKey 로 보증.
        emitNotification({
          type: 'work.assigned',
          projectId,
          entityType: 'wbs_item',
          entityId: itemId,
          payload: {
            title: args.titleByRef[ref] ?? ref,
            detail: '작업이 배정되었습니다',
            href: `/p/${projectId}/wbs`,
          },
          recipientMemberIds: [memberId],
          dedupeKey: `assigned:${ref}:${memberId}`,
        }).catch(() => {
          // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않음(emitNotification 내부에서 로깅)
        })
      }
    }

    // 주문 보장 — kind='task' 인 모든 신규 ref 대상(배정 여부 무관). wp/act/phase 는 애초 주문 대상이 아니므로
    // ensureOrderForWorkflowLeaf 를 호출하지도 않는다(not_workflow 판정을 받으러 갈 필요가 없다).
    if (args.kindByRef[ref] !== 'task') continue
    const ensured = await ensureOrderForWorkflowLeaf(admin, { projectId, wbsItemId: itemId, actorUserId })
    if (!ensured.ok) throw new Error(`자동 발행 실패(${ref}): ${ensured.error}`)
    if (ensured.created) ordersCreated += 1
    // unmatched_assignees 와 동일 규칙(bare id) — 클라이언트는 module 프리픽스를 모른다.
    // not_workflow 는 리포트하지 않는다(정상 경로 — task 인데 dev_workflow 미도입 상태는 나올 수 없다).
    if (ensured.reason === 'not_leaf') nonLeafSkipped.push(ref.slice(module.length + 1))
  }
  return { unmatched, ordersCreated, nonLeafSkipped }
}
