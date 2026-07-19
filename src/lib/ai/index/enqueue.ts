import type { IndexJobQueue, IndexMutation } from './types'

/**
 * 업무 쓰기 경로용 best-effort enqueue 헬퍼.
 * - CHAT_V2_INDEX_ENQUEUE_ENABLED !== 'true' 이면 완전한 no-op(운영 기본값).
 * - 어떤 실패도 로그만 남기고 절대 throw하지 않는다 — 색인 실패가 업무 데이터
 *   변경을 막거나 롤백해서는 안 된다(설계 §10.4). 누락분은 정합성 검사가 보완한다.
 * - 이번 단계에서는 운영 쓰기 경로에 배선하지 않는다(별도 승인 후 연결).
 */
export async function enqueueIndexMutationBestEffort(
  queue: Pick<IndexJobQueue, 'enqueue'>,
  mutations: readonly IndexMutation[],
): Promise<void> {
  if (process.env.CHAT_V2_INDEX_ENQUEUE_ENABLED !== 'true') return
  if (mutations.length === 0) return
  try {
    const result = await queue.enqueue(mutations)
    if (!result.ok) {
      console.error(`[dkbot] 색인 작업 enqueue 실패(무시하고 계속): ${result.error.code}`)
    }
  } catch (e) {
    console.error('[dkbot] 색인 작업 enqueue 예외(무시하고 계속):', e instanceof Error ? e.message : e)
  }
}
