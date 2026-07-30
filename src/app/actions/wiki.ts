'use server'
// Wiki 큐레이션 액션 — 사람이 자동 반영 결과를 정리하는 유일한 경로.
// 테이블 쓰기 정책은 0045/0048 모두 열지 않으므로 실제 변경은 security definer RPC가 하고,
// 여기서는 프로젝트 관리자 fail-closed와 허용 동작 화이트리스트만 강제한다.
// 문장 자체는 어떤 경로로도 수정할 수 없다 — 잘못 추출된 항목은 archive(숨김)로 처리한다.
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { requireProjectAdmin } from '@/lib/authz'

export const WIKI_CURATE_ACTIONS = [
  'resolve', 'reopen', 'archive', 'restore', 'lock', 'unlock', 'confirm',
] as const
export type WikiCurateAction = (typeof WIKI_CURATE_ACTIONS)[number]

export interface WikiActionResult {
  ok: boolean
  error?: string
}

const REASON_MAX = 500

function friendlyError(message: string | undefined): string {
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
  // PGRST202 = 함수 미존재. 마이그레이션 미적용 환경을 원인 그대로 알린다.
  if (message.includes('PGRST202') || message.includes('does not exist')) {
    return 'Wiki 정리 기능이 아직 이 환경에 배포되지 않았습니다.'
  }
  return 'Wiki 정리에 실패했습니다.'
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
    return { ok: false, error: friendlyError(error.message) }
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
    .from('wiki_topics').select('id')
    .in('id', [args.sourceTopicId, args.targetTopicId]).eq('project_id', args.projectId)
  if (topicErr) {
    console.error('[wiki] 대상 주제 소속 확인 실패:', topicErr.message)
    return { ok: false, error: '대상을 확인할 수 없어 중단했습니다.' }
  }
  if (!topics || topics.length !== 2) {
    return { ok: false, error: '같은 프로젝트의 서로 다른 주제만 병합할 수 있습니다.' }
  }

  const { error } = await sb.rpc('merge_wiki_topics', {
    p_source_topic_id: args.sourceTopicId,
    p_target_topic_id: args.targetTopicId,
  })
  if (error) {
    console.error('[wiki] 주제 병합 실패:', error.message)
    return { ok: false, error: friendlyError(error.message) }
  }

  revalidatePath(`/p/${args.projectId}/wiki`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.sourceTopicId}`)
  revalidatePath(`/p/${args.projectId}/wiki/topics/${args.targetTopicId}`)
  return { ok: true }
}
