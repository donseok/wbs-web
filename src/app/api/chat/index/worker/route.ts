import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  INDEX_BACKFILL_DOMAINS,
  checkIndexConsistency,
  createSupabaseIndexContentLoader,
  createSupabaseIndexJobQueue,
  createSupabaseIndexSourceLister,
  createSupabasePgvectorKnowledgeIndex,
  listIndexedEntitySummaries,
  runIndexBackfill,
  runIndexWorkerOnce,
  type IndexBackfillDomain,
  type SupabaseKnowledgeClient,
} from '@/lib/ai/index'

export const dynamic = 'force-dynamic'

const MAX_BATCH_SIZE = 200

interface WorkerRequestBody {
  mode: 'worker' | 'consistency' | 'backfill'
  domain?: IndexBackfillDomain
  projectId?: string
  dryRun?: boolean
  batchSize?: number
}

/** 시크릿 비교는 길이 노출·타이밍 채널을 피하기 위해 해시 후 상수시간으로 비교한다. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function parseBody(raw: unknown): WorkerRequestBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  if (body.mode !== 'worker' && body.mode !== 'consistency' && body.mode !== 'backfill') return null

  const parsed: WorkerRequestBody = { mode: body.mode }
  if (body.domain !== undefined) {
    if (!(INDEX_BACKFILL_DOMAINS as readonly unknown[]).includes(body.domain)) return null
    parsed.domain = body.domain as IndexBackfillDomain
  }
  if (body.projectId !== undefined) {
    if (typeof body.projectId !== 'string' || !body.projectId.trim() || body.projectId.length > 64) return null
    parsed.projectId = body.projectId.trim()
  }
  if (body.dryRun !== undefined) {
    if (typeof body.dryRun !== 'boolean') return null
    parsed.dryRun = body.dryRun
  }
  if (body.batchSize !== undefined) {
    if (!Number.isInteger(body.batchSize) || Number(body.batchSize) < 1 || Number(body.batchSize) > MAX_BATCH_SIZE) return null
    parsed.batchSize = body.batchSize as number
  }
  // consistency/backfill은 도메인이 없으면 대상 자체가 정의되지 않는다.
  if (parsed.mode !== 'worker' && !parsed.domain) return null
  return parsed
}

/**
 * 증분 색인 워커 보호 라우트(설계 §10.4). cron 등록은 배포 결정 사항이라 여기서 하지 않는다.
 * 게이트: ① CHAT_V2_INDEX_WORKER_ENABLED ② x-cron-secret(미설정이면 존재 자체를 숨긴다=404).
 */
export async function POST(req: NextRequest) {
  if (process.env.CHAT_V2_INDEX_WORKER_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }
  const expectedSecret = process.env.CHAT_V2_INDEX_CRON_SECRET
  if (!expectedSecret) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  if (!secretMatches(req.headers.get('x-cron-secret'), expectedSecret)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const body = parseBody(raw)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  try {
    // service-role 전용 조립. 어댑터 스코프는 실제 프로젝트 전체 + global(회의 미연결 회의록).
    const admin = createAdminClient() as unknown as SupabaseKnowledgeClient
    const projectsResult = await admin.from('projects').select('id').limit(100)
    if (projectsResult.error || !Array.isArray(projectsResult.data)) {
      return NextResponse.json({ error: '프로젝트 범위를 확인하지 못했습니다.' }, { status: 503 })
    }
    const allowedProjectIds = (projectsResult.data as Array<{ id?: unknown }>)
      .map(row => (typeof row.id === 'string' ? row.id : ''))
      .filter(Boolean)
    const accessScope = { allowedProjectIds, allowGlobal: true }
    const queue = createSupabaseIndexJobQueue(admin, accessScope)

    if (body.mode === 'worker') {
      const summary = await runIndexWorkerOnce({
        queue,
        index: createSupabasePgvectorKnowledgeIndex(admin, accessScope),
        loadContent: createSupabaseIndexContentLoader(admin),
        batchSize: body.batchSize,
      })
      return NextResponse.json({ mode: 'worker', ...summary })
    }

    const domain = body.domain as IndexBackfillDomain
    if (body.mode === 'backfill') {
      const summary = await runIndexBackfill({
        domain,
        projectId: body.projectId,
        list: createSupabaseIndexSourceLister(admin),
        enqueue: mutations => queue.enqueue(mutations),
        dryRun: body.dryRun,
        batchSize: body.batchSize,
      })
      return NextResponse.json({ mode: 'backfill', ...summary })
    }

    const [sourcesResult, indexedResult] = await Promise.all([
      createSupabaseIndexSourceLister(admin)(domain, body.projectId),
      listIndexedEntitySummaries(admin, { domain, projectId: body.projectId }),
    ])
    if (!sourcesResult.ok || !indexedResult.ok) {
      return NextResponse.json({ error: '정합성 검사 조회에 실패했습니다.' }, { status: 503 })
    }
    const report = await checkIndexConsistency({
      sources: sourcesResult.data,
      indexed: indexedResult.data,
      enqueue: body.dryRun ? undefined : mutations => queue.enqueue(mutations),
      limit: body.batchSize,
    })
    // 엔티티 목록은 응답에 싣지 않는다(내부 식별자 노출 최소화) — 수량 요약만.
    return NextResponse.json({
      mode: 'consistency',
      checked: report.checked,
      planned: report.mutations.length,
      enqueued: report.enqueued,
      enqueueErrorCode: report.enqueueErrorCode,
      dryRun: Boolean(body.dryRun),
    })
  } catch (e) {
    console.error('[dkbot] /api/chat/index/worker 오류:', e)
    return NextResponse.json({ error: '색인 워커 실행에 실패했습니다.' }, { status: 500 })
  }
}
