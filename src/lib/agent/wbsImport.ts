import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForAssignedLeaf } from '@/lib/agent/ensureOrder'
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
const STAGES = new Set(['todo', 'as', 'fp', 'ip', 'im', 'xx'])
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
      acceptance: string[]; spec: string | null }
  | { error: string } {
  if (!n.id || !n.title) return { error: `id·title 필수: ${JSON.stringify(n.id)}` }
  if (n.stage !== null && n.stage !== undefined && !STAGES.has(n.stage)) return { error: `허용 밖 stage: ${n.stage} (${n.id})` }
  if (n.priority !== null && n.priority !== undefined && !PRIORITY_LABELS.has(n.priority)) {
    return { error: `허용 밖 priority 라벨: ${n.priority} (${n.id})` }
  }
  const sched = parseSchedule(n.schedule)
  if ('error' in sched) return { error: `${sched.error} (${n.id})` }
  return {
    external_ref: `${module}/${n.id}`,
    parent_external_ref: n.parent_id ? `${module}/${n.parent_id}` : null,
    title: n.title, stage: n.stage ?? null,
    planned_start: sched.start, planned_end: sched.end,
    sort_order: index, // 파일 내 등장 순서가 정렬 정본 — priority 는 정렬이 아니라 라벨(결정 E)
    assignee: n.assignee ? n.assignee.trim().toLowerCase() : null,
    category: n.category ?? null, domain: n.domain ?? null, priority: n.priority ?? null,
    model: n.model ?? null, tags: n.tags ?? [],
    depends: (n.depends ?? []).map(d => `${module}/${d}`), // 선행도 external_ref 로 저장(결정 C 게이트 키)
    prd_ref: n.prd_ref ?? null, entry_point: n.entry_point ?? null,
    acceptance: n.acceptance ?? [], spec: assembleSpecMarkdown(n.spec_sections),
  }
}

/** 업로드 후처리 — 신규 리프의 assignee email 을 로스터에 매칭하고 자동 발행까지(§2.6·§2.8). */
export async function applyAssigneesAndOrders(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string
    newRefs: string[]; idsByRef: Record<string, string>
    assigneeByRef: Record<string, string | null>; titleByRef: Record<string, string> },
): Promise<{ unmatched: Array<{ external_ref: string; assignee: string }>; ordersCreated: number; nonLeafSkipped: string[] }> {
  const { projectId, actorUserId } = args
  const unmatched: Array<{ external_ref: string; assignee: string }> = []
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
    const email = args.assigneeByRef[ref]
    if (!email) continue
    const itemId = args.idsByRef[ref]
    if (!itemId) continue
    const memberId = memberByEmail.get(email)
    if (!memberId) {
      unmatched.push({ external_ref: ref, assignee: email }) // 생략하지 않고 전량 리포트
      continue
    }
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
    const ensured = await ensureOrderForAssignedLeaf(admin, { projectId, wbsItemId: itemId, actorUserId })
    if (!ensured.ok) throw new Error(`자동 발행 실패(${ref}): ${ensured.error}`)
    if (ensured.created) ordersCreated += 1
    if (ensured.reason === 'not_leaf') nonLeafSkipped.push(ref)
  }
  return { unmatched, ordersCreated, nonLeafSkipped }
}
