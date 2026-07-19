import { safeIndexJobErrorCode } from './jobs'
import type {
  ClaimedIndexJob,
  IndexContentLoader,
  IndexDeleteSelector,
  IndexJobWorkerQueue,
  IndexWorkerRunSummary,
  KnowledgeIndex,
} from './types'

export const INDEX_WORKER_DEFAULT_BATCH = 10
export const INDEX_WORKER_DEFAULT_LEASE_SECONDS = 300

const MAX_INT32 = 2_147_483_647

export interface IndexWorkerDeps {
  queue: IndexJobWorkerQueue
  index: KnowledgeIndex
  loadContent: IndexContentLoader
  batchSize?: number
  leaseSeconds?: number
  now?: Date
}

/** payload.indexVersion이 유효한 양의 정수면 그 버전을, 아니면 현행 1을 대상으로 삼는다. */
function jobIndexVersion(job: ClaimedIndexJob): number {
  const raw = job.payload.indexVersion
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_INT32 ? raw : 1
}

function deleteSelector(job: ClaimedIndexJob): IndexDeleteSelector {
  return {
    projectId: job.projectId,
    domain: job.domain,
    entityType: job.entityType,
    entityId: job.entityId,
    indexVersion: jobIndexVersion(job),
  }
}

type JobOutcome = 'upserted' | 'deleted' | 'failed' | 'requeued'

/**
 * 증분 색인 워커 1회 실행 — 순수 오케스트레이션(모든 I/O는 주입된 deps).
 *
 * [tombstone 규약] delete가 최신 generation이면 뒤늦은 구세대 upsert는 complete CAS에
 * 걸려 pending으로 재실행되고, 재실행 시 콘텐츠 로더가 원본 부재(null)를 확인해
 * delete로 수렴한다. 문서 쪽은 replace_ai_document_chunks(0031)의 타임스탬프 가드가
 * 오래된 덮어쓰기를 별도로 차단한다 — 이중 방어.
 */
export async function runIndexWorkerOnce(deps: IndexWorkerDeps): Promise<IndexWorkerRunSummary> {
  const summary: IndexWorkerRunSummary = { claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0 }
  const batchSize = deps.batchSize ?? INDEX_WORKER_DEFAULT_BATCH
  const leaseSeconds = deps.leaseSeconds ?? INDEX_WORKER_DEFAULT_LEASE_SECONDS
  const now = deps.now ?? new Date()

  const claimed = await deps.queue.claim(batchSize, leaseSeconds)
  if (!claimed.ok) {
    // claim 실패는 처리할 작업 자체가 없다 — 0 요약을 돌려주되 실패를 삼키지 않고 로깅한다.
    console.error(`[dkbot] 색인 워커 claim 실패: ${claimed.error.code}`)
    return summary
  }
  summary.claimed = claimed.data.length

  for (const job of claimed.data) {
    const outcome = await processJob(deps, job, now)
    summary[outcome] += 1
  }
  return summary
}

async function processJob(deps: IndexWorkerDeps, job: ClaimedIndexJob, now: Date): Promise<JobOutcome> {
  try {
    if (job.operation === 'delete') {
      const removed = await deps.index.delete(deleteSelector(job))
      if (!removed.ok) return failJob(deps, job, removed.error.code, now)
      return completeJob(deps, job)
    }

    const loaded = await deps.loadContent(job)
    if (!loaded.ok) return failJob(deps, job, loaded.errorCode, now)

    // 원본 소멸(null) 또는 색인할 텍스트 0건 → 구형 청크를 남기지 않도록 delete로 수렴.
    if (loaded.data === null || loaded.data.documents.length === 0) {
      const removed = await deps.index.delete(deleteSelector(job))
      if (!removed.ok) return failJob(deps, job, removed.error.code, now)
      return completeJob(deps, job)
    }

    const upserted = await deps.index.upsert(loaded.data.documents, { replaceEntityChunks: true })
    if (!upserted.ok) return failJob(deps, job, upserted.error.code, now)
    return completeJob(deps, job, 'upserted')
  } catch (e) {
    // 한 작업의 예기치 못한 예외가 배치 전체를 무너뜨리지 않게 격리한다.
    console.error('[dkbot] 색인 작업 처리 예외:', e instanceof Error ? e.message : e)
    return failJob(deps, job, 'INDEX_JOB_FAILED', now)
  }
}

async function completeJob(
  deps: IndexWorkerDeps,
  job: ClaimedIndexJob,
  successOutcome: 'upserted' | 'deleted' = 'deleted',
): Promise<JobOutcome> {
  const completed = await deps.queue.complete({ id: job.id, generation: job.generation })
  if (!completed.ok) {
    // 완료 기록 실패 — 행은 running으로 남고 lease 만료 후 재선점된다.
    console.error(`[dkbot] 색인 작업 complete 실패(job ${job.jobKey}): ${completed.error.code}`)
    return 'failed'
  }
  // CAS 불일치: 처리 중 새 generation이 enqueue됨 → 서버가 pending으로 복귀시켰고 재처리된다.
  return completed.data.applied ? successOutcome : 'requeued'
}

async function failJob(
  deps: IndexWorkerDeps,
  job: ClaimedIndexJob,
  errorCode: string,
  now: Date,
): Promise<JobOutcome> {
  const failed = await deps.queue.fail(
    { id: job.id, generation: job.generation, attempts: job.attempts },
    safeIndexJobErrorCode(errorCode),
    now,
  )
  if (!failed.ok) {
    console.error(`[dkbot] 색인 작업 fail 기록 실패(job ${job.jobKey}): ${failed.error.code}`)
  }
  return 'failed'
}
