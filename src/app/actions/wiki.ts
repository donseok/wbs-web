'use server'
// Wiki 큐레이션 액션 — 사람이 자동 반영 결과를 정리하는 유일한 경로.
// 테이블 쓰기 정책은 0045/0048 모두 열지 않으므로 실제 변경은 security definer RPC가 하고,
// 여기서는 프로젝트 관리자 fail-closed와 허용 동작 화이트리스트만 강제한다.
// 문장 자체는 어떤 경로로도 수정할 수 없다 — 잘못 추출된 항목은 archive(숨김)로 처리한다.
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'

export const WIKI_CURATE_ACTIONS = [
  'resolve', 'reopen', 'archive', 'restore', 'lock', 'unlock', 'confirm',
] as const
export type WikiCurateAction = (typeof WIKI_CURATE_ACTIONS)[number]

export interface WikiActionResult {
  ok: boolean
  error?: string
}

export const WIKI_DOCUMENT_KINDS = [
  'overview', 'decision', 'how_to', 'runbook', 'faq', 'glossary', 'reference',
] as const
export type WikiDocumentKind = (typeof WIKI_DOCUMENT_KINDS)[number]

export interface WikiDocumentActionResult extends WikiActionResult {
  topicId?: string
  updatedAt?: string
  versionNo?: number
  conflict?: boolean
}

const WIKI_TITLE_MAX = 160
const WIKI_BODY_MAX = 100_000
const WIKI_QUESTION_MAX = 2_000
const WIKI_ANSWER_MAX = 20_000

const REASON_MAX = 500

/**
 * PostgREST 오류를 사용자 문장으로. **code 와 message 를 함께 받는다** — 함수 미존재는
 * code 에만 담겨 오기 때문이다(실측: `{code:'PGRST202', message:'Could not find the
 * function public.create_wiki_document(...) in the schema cache'}`). message 만 넘기던
 * 이전 시그니처에서는 아래 PGRST202 분기가 한 번도 매치되지 않아, 마이그레이션 미적용
 * 환경에서 원인 안내 대신 일반 실패 문구가 나갔다.
 */
function friendlyError(error: { code?: string; message?: string } | string | undefined): string {
  const { code, message } = typeof error === 'string'
    ? { code: undefined, message: error }
    : { code: error?.code, message: error?.message }
  // PGRST202 = RPC 스키마 캐시 미존재, 42883 = undefined_function. 마이그레이션 미적용을
  // 원인 그대로 알린다. 다른 분기보다 먼저 본다 — 이 경우 message 는 사용자에게 의미 없다.
  if (code === 'PGRST202' || code === '42883') {
    return 'Wiki 정리 기능이 아직 이 환경에 배포되지 않았습니다.'
  }
  if (!message) return 'Wiki 정리에 실패했습니다.'
  if (message.includes('WIKI_CURATE_FORBIDDEN') || message.includes('WIKI_MERGE_FORBIDDEN')) {
    return '권한이 없습니다.'
  }
  if (message.includes('WIKI_CURATE_INVALID_TRANSITION')) {
    return '현재 상태에서는 할 수 없는 작업입니다. 화면을 새로고침한 뒤 다시 시도하세요.'
  }
  if (message.includes('WIKI_ITEM_NOT_FOUND') || message.includes('WIKI_TOPIC_NOT_FOUND')) {
    return '대상을 찾을 수 없습니다. 이미 정리되었을 수 있습니다.'
  }
  if (message.includes('WIKI_MERGE_CROSS_PROJECT') || message.includes('WIKI_MERGE_SAME_TOPIC')) {
    return '같은 프로젝트의 서로 다른 주제만 병합할 수 있습니다.'
  }
  if (message.includes('WIKI_CURATE_NO_LIVE_SOURCE')) {
    return '원문 근거가 모두 철회된 항목이라 되돌릴 수 없습니다. 회의록이 보관되었거나 다른 프로젝트로 옮겨졌는지 확인하세요.'
  }
  if (message.includes('WIKI_DOCUMENT_EDIT_CONFLICT')) {
    return '다른 사람이 먼저 저장했습니다. 최신 내용을 확인한 뒤 다시 시도하세요.'
  }
  if (message.includes('WIKI_DOCUMENT_FORBIDDEN') || message.includes('WIKI_QUESTION_FORBIDDEN')) {
    return '이 프로젝트의 구성원만 지식을 편집할 수 있습니다.'
  }
  if (message.includes('WIKI_DOCUMENT_PARENT_INVALID')) {
    return '같은 프로젝트의 문서만 상위 문서로 지정할 수 있습니다.'
  }
  if (message.includes('WIKI_DOCUMENT_INVALID') || message.includes('WIKI_QUESTION_INVALID')) {
    return '입력 내용을 확인해 주세요.'
  }
  // code 가 비어 오는 경로(래핑된 예외 등)를 위한 보조 판정.
  if (message.includes('PGRST202') || message.includes('does not exist')) {
    return 'Wiki 정리 기능이 아직 이 환경에 배포되지 않았습니다.'
  }
  return 'Wiki 정리에 실패했습니다.'
}

function validDocumentKind(value: string): value is WikiDocumentKind {
  return (WIKI_DOCUMENT_KINDS as readonly string[]).includes(value)
}

function textWithin(value: string, max: number): boolean {
  return value.trim().length > 0 && value.length <= max
}

async function topicBelongsToProject(
  topicId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('wiki_topics')
    .select('id').eq('id', topicId).eq('project_id', projectId).maybeSingle()
  if (error) {
    console.error('[wiki] 문서 소속 확인 실패:', error.message)
    return { ok: false, error: '대상을 확인할 수 없어 중단했습니다.' }
  }
  return data
    ? { ok: true }
    : { ok: false, error: '대상을 찾을 수 없습니다. 이미 변경되었을 수 있습니다.' }
}

/** 사람이 관리하는 정본 문서를 만든다. AI 항목과 원문 근거는 별도 층으로 그대로 남는다. */
export async function createWikiDocument(args: {
  projectId: string
  title: string
  bodyMd: string
  documentKind: WikiDocumentKind
  parentId?: string | null
}): Promise<WikiDocumentActionResult> {
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const title = args.title.trim()
  if (!textWithin(title, WIKI_TITLE_MAX) || args.bodyMd.length > WIKI_BODY_MAX) {
    return { ok: false, error: '제목과 본문 길이를 확인해 주세요.' }
  }
  if (!validDocumentKind(args.documentKind)) {
    return { ok: false, error: '알 수 없는 문서 유형입니다.' }
  }

  const sb = await createServerClient()
  const { data, error } = await sb.rpc('create_wiki_document', {
    p_project_id: args.projectId,
    p_title: title,
    p_body_md: args.bodyMd,
    p_document_kind: args.documentKind,
    p_parent_id: args.parentId ?? null,
  })
  if (error) {
    console.error('[wiki] 문서 생성 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  const topicId = typeof data === 'string'
    ? data
    : data && typeof data === 'object' && 'id' in data && typeof data.id === 'string'
      ? data.id
      : null
  if (!topicId) return { ok: false, error: '문서를 만들었지만 새 문서 주소를 확인하지 못했습니다.' }
  revalidatePath(`/p/${args.projectId}/wiki`)
  return { ok: true, topicId }
}

/** 제목·본문 저장. expectedUpdatedAt으로 공동 편집 충돌을 덮어쓰지 않는다. */
export async function updateWikiDocument(args: {
  projectId: string
  topicId: string
  title: string
  bodyMd: string
  documentKind: WikiDocumentKind
  expectedUpdatedAt?: string | null
}): Promise<WikiDocumentActionResult> {
  // 권한 가드가 먼저다. 대상 결합 조회를 앞에 두면, 읽기 범위를 좁히는 날 비권한자에게
  // '권한 없음' 대신 '대상을 찾을 수 없습니다'가 나가 존재 여부가 샌다(fail-closed 역전).
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const target = await topicBelongsToProject(args.topicId, args.projectId)
  if (!target.ok) return target
  const title = args.title.trim()
  if (!textWithin(title, WIKI_TITLE_MAX) || args.bodyMd.length > WIKI_BODY_MAX) {
    return { ok: false, error: '제목과 본문 길이를 확인해 주세요.' }
  }
  if (!validDocumentKind(args.documentKind)) {
    return { ok: false, error: '알 수 없는 문서 유형입니다.' }
  }

  const sb = await createServerClient()
  const { data, error } = await sb.rpc('save_wiki_document', {
    p_topic_id: args.topicId,
    p_title: title,
    p_body_md: args.bodyMd,
    p_document_kind: args.documentKind,
    p_expected_updated_at: args.expectedUpdatedAt ?? null,
  })
  if (error) {
    console.error('[wiki] 문서 저장 실패:', error.message)
    const conflict = error.message.includes('WIKI_DOCUMENT_EDIT_CONFLICT')
    return { ok: false, error: friendlyError(error), conflict }
  }
  const row = Array.isArray(data) ? data[0] : data
  const updatedAt = row && typeof row === 'object' && typeof row.body_updated_at === 'string'
    ? row.body_updated_at
    : undefined
  const versionNo = row && typeof row === 'object' && typeof row.version_no === 'number'
    ? row.version_no
    : undefined
  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return { ok: true, topicId: args.topicId, updatedAt, versionNo }
}

/** 현재 내용을 검증하고 유형별 검토 주기를 시작한다. */
export async function verifyWikiDocument(args: {
  projectId: string
  topicId: string
  reviewDays?: number
  expectedUpdatedAt?: string | null
}): Promise<WikiDocumentActionResult> {
  // 권한 가드가 먼저다. 대상 결합 조회를 앞에 두면, 읽기 범위를 좁히는 날 비권한자에게
  // '권한 없음' 대신 '대상을 찾을 수 없습니다'가 나가 존재 여부가 샌다(fail-closed 역전).
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const target = await topicBelongsToProject(args.topicId, args.projectId)
  if (!target.ok) return target
  const reviewDays = args.reviewDays ?? 90
  if (!Number.isInteger(reviewDays) || reviewDays < 1 || reviewDays > 365) {
    return { ok: false, error: '검토 주기는 1~365일이어야 합니다.' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('verify_wiki_document', {
    p_topic_id: args.topicId,
    p_review_days: reviewDays,
    p_expected_updated_at: args.expectedUpdatedAt ?? null,
  })
  if (error) {
    console.error('[wiki] 문서 검증 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  const row = Array.isArray(data) ? data[0] : data
  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return {
    ok: true,
    topicId: args.topicId,
    updatedAt: row && typeof row === 'object' && typeof row.verified_at === 'string'
      ? row.verified_at
      : undefined,
  }
}

export async function restoreWikiDocumentRevision(args: {
  projectId: string
  topicId: string
  revisionId: string
  expectedUpdatedAt?: string | null
}): Promise<WikiDocumentActionResult> {
  // 권한 가드가 먼저다. 대상 결합 조회를 앞에 두면, 읽기 범위를 좁히는 날 비권한자에게
  // '권한 없음' 대신 '대상을 찾을 수 없습니다'가 나가 존재 여부가 샌다(fail-closed 역전).
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const target = await topicBelongsToProject(args.topicId, args.projectId)
  if (!target.ok) return target
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('restore_wiki_document_revision', {
    p_topic_id: args.topicId,
    p_revision_id: args.revisionId,
    p_expected_updated_at: args.expectedUpdatedAt ?? null,
  })
  if (error) {
    console.error('[wiki] 문서 이력 복원 실패:', error.message)
    const conflict = error.message.includes('WIKI_DOCUMENT_EDIT_CONFLICT')
    return { ok: false, error: friendlyError(error), conflict }
  }
  const row = Array.isArray(data) ? data[0] : data
  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return {
    ok: true,
    topicId: args.topicId,
    updatedAt: row && typeof row === 'object' && typeof row.body_updated_at === 'string'
      ? row.body_updated_at
      : undefined,
    versionNo: row && typeof row === 'object' && typeof row.version_no === 'number'
      ? row.version_no
      : undefined,
  }
}

/** 근거가 부족한 Ask를 사라지지 않는 지식 공백으로 남긴다. */
export async function createWikiQuestion(args: {
  projectId: string
  question: string
  topicId?: string | null
}): Promise<WikiActionResult & { questionId?: string }> {
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const question = args.question.trim()
  if (!textWithin(question, WIKI_QUESTION_MAX)) {
    return { ok: false, error: '질문을 2,000자 이내로 입력해 주세요.' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('create_wiki_question', {
    p_project_id: args.projectId,
    p_topic_id: args.topicId ?? null,
    p_question: question,
  })
  if (error) {
    console.error('[wiki] 질문 등록 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  const questionId = typeof data === 'string' ? data : undefined
  revalidatePath(`/p/${args.projectId}/wiki`)
  return { ok: true, questionId }
}

export async function answerWikiQuestion(args: {
  projectId: string
  questionId: string
  answerMd: string
  topicId?: string | null
}): Promise<WikiActionResult> {
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const answer = args.answerMd.trim()
  if (!textWithin(answer, WIKI_ANSWER_MAX)) {
    return { ok: false, error: '답변을 20,000자 이내로 입력해 주세요.' }
  }
  const sb = await createServerClient()
  const { data: question, error: targetError } = await sb.from('wiki_questions')
    .select('id').eq('id', args.questionId).eq('project_id', args.projectId).maybeSingle()
  if (targetError || !question) {
    if (targetError) console.error('[wiki] 질문 소속 확인 실패:', targetError.message)
    return { ok: false, error: targetError ? '대상을 확인할 수 없어 중단했습니다.' : '질문을 찾을 수 없습니다.' }
  }
  const { error } = await sb.rpc('answer_wiki_question', {
    p_question_id: args.questionId,
    p_answer: answer,
    p_topic_id: args.topicId ?? null,
  })
  if (error) {
    console.error('[wiki] 질문 답변 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  revalidatePath(`/p/${args.projectId}/wiki`)
  return { ok: true }
}

export async function reviewWikiItem(args: {
  projectId: string
  topicId: string
  itemId: string
  reviewState: 'accepted' | 'rejected' | 'pending'
}): Promise<WikiActionResult> {
  const gate = await requireProjectAdmin(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const sb = await createServerClient()
  const { data: item, error: targetError } = await sb.from('wiki_items')
    .select('id').eq('id', args.itemId).eq('project_id', args.projectId).maybeSingle()
  if (targetError || !item) {
    if (targetError) console.error('[wiki] 제안 소속 확인 실패:', targetError.message)
    return { ok: false, error: targetError ? '대상을 확인할 수 없어 중단했습니다.' : '제안을 찾을 수 없습니다.' }
  }
  const { error } = await sb.rpc('review_wiki_item', {
    p_item_id: args.itemId,
    p_review_state: args.reviewState,
  })
  if (error) {
    console.error('[wiki] 제안 검토 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return { ok: true }
}

/** 읽는 사람의 작은 기여 — 긴 편집 대신 도움됨/오래됨 신호로 유지관리 루프에 진입한다. */
export async function submitWikiFeedback(args: {
  projectId: string
  topicId: string
  kind: 'helpful' | 'outdated'
  comment?: string | null
}): Promise<WikiActionResult & { feedbackId?: string }> {
  // 권한 가드가 먼저다. 대상 결합 조회를 앞에 두면, 읽기 범위를 좁히는 날 비권한자에게
  // '권한 없음' 대신 '대상을 찾을 수 없습니다'가 나가 존재 여부가 샌다(fail-closed 역전).
  const gate = await requireProjectMember(args.projectId)
  if (!gate.ok) return { ok: false, error: gate.error }
  const target = await topicBelongsToProject(args.topicId, args.projectId)
  if (!target.ok) return target
  if (!['helpful', 'outdated'].includes(args.kind)) {
    return { ok: false, error: '알 수 없는 피드백 유형입니다.' }
  }
  const comment = args.comment?.trim() || null
  if (comment && comment.length > 500) {
    return { ok: false, error: '의견은 500자 이내로 입력해 주세요.' }
  }
  const sb = await createServerClient()
  const { data, error } = await sb.rpc('submit_wiki_feedback', {
    p_topic_id: args.topicId,
    p_kind: args.kind,
    p_comment: comment,
  })
  if (error) {
    console.error('[wiki] 피드백 등록 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }
  const feedbackId = typeof data === 'string' ? data : undefined
  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return { ok: true, feedbackId }
}

/**
 * 항목 상태 정리. projectId 는 revalidate 대상 겸 관리자 판정 기준이므로, **대상 항목이 실제로
 * 그 프로젝트 것인지 여기서 결합해야 한다** — 클라이언트가 보낸 projectId 만 믿으면 자기가
 * 관리자인 프로젝트를 적어 남의 프로젝트 항목을 정리할 수 있다.
 * (0053 이 RPC 안의 판정도 대상 항목의 프로젝트 기준으로 바꿨다 — 여기가 1차, RPC 가 2차다.)
 */
export async function curateWikiItem(args: {
  projectId: string
  topicId: string
  itemId: string
  action: WikiCurateAction
  reason?: string
}): Promise<WikiActionResult> {
  const g = await requireProjectAdmin(args.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!(WIKI_CURATE_ACTIONS as readonly string[]).includes(args.action)) {
    return { ok: false, error: '알 수 없는 작업입니다.' }
  }

  const sb = await createServerClient()
  // 대상 결합 — 조회 실패는 쓰기 중단 사유다(3원칙 ②).
  const { data: item, error: itemErr } = await sb
    .from('wiki_items').select('id').eq('id', args.itemId).eq('project_id', args.projectId).maybeSingle()
  if (itemErr) {
    console.error('[wiki] 대상 항목 소속 확인 실패:', itemErr.message)
    return { ok: false, error: '대상을 확인할 수 없어 중단했습니다.' }
  }
  if (!item) return { ok: false, error: '대상을 찾을 수 없습니다. 이미 정리되었을 수 있습니다.' }

  const { error } = await sb.rpc('curate_wiki_item', {
    p_item_id: args.itemId,
    p_action: args.action,
    p_reason: args.reason ? args.reason.slice(0, REASON_MAX) : null,
  })
  if (error) {
    console.error('[wiki] 항목 큐레이션 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }

  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.topicId}`)
  return { ok: true }
}

/** 갈라진 주제 병합. RPC도 관리자만 허용하며 항목·knowledge_key까지 정본으로 옮긴다. */
export async function mergeWikiTopics(args: {
  projectId: string
  sourceTopicId: string
  targetTopicId: string
}): Promise<WikiActionResult> {
  const g = await requireProjectAdmin(args.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (args.sourceTopicId === args.targetTopicId) {
    return { ok: false, error: '서로 다른 주제를 선택하세요.' }
  }

  const sb = await createServerClient()
  // 두 주제가 모두 판정 기준 프로젝트의 것인지 결합한다 — RPC 는 source·target 이 같은
  // 프로젝트인지만 보므로, 결합이 없으면 남의 프로젝트 주제끼리 병합할 수 있다.
  const { data: topics, error: topicErr } = await sb
    .from('wiki_topics').select('id, body_md, origin')
    .in('id', [args.sourceTopicId, args.targetTopicId]).eq('project_id', args.projectId)
  if (topicErr) {
    console.error('[wiki] 대상 주제 소속 확인 실패:', topicErr.message)
    return { ok: false, error: '대상을 확인할 수 없어 중단했습니다.' }
  }
  if (!topics || topics.length !== 2) {
    return { ok: false, error: '같은 프로젝트의 서로 다른 주제만 병합할 수 있습니다.' }
  }
  // 0079부터 문서는 append-only revision을 가진 정본이다. 기존 merge RPC는 source 행을
  // 삭제하므로 문서 병합은 이력 보존 전략 없이 수행할 수 없다. AI 주제끼리만 허용한다.
  if ((topics as Array<{ body_md?: string | null; origin?: string | null }>).some((topic) => (
    topic.origin === 'manual' || topic.body_md?.trim()
  ))) {
    return { ok: false, error: '사람이 작성한 문서는 병합할 수 없습니다. 문서 내용을 옮긴 뒤 주제를 정리해 주세요.' }
  }

  const { error } = await sb.rpc('merge_wiki_topics', {
    p_source_topic_id: args.sourceTopicId,
    p_target_topic_id: args.targetTopicId,
  })
  if (error) {
    console.error('[wiki] 주제 병합 실패:', error.message)
    return { ok: false, error: friendlyError(error) }
  }

  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.sourceTopicId}`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.targetTopicId}`)
  return { ok: true }
}
