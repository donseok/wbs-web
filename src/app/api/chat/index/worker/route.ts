import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocuments } from '@/lib/ai/embeddings'
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
// repair 모드는 임베딩 API 호출 1건당 지연이 커서(withTimeout) 워커/백필보다 상한을 낮게 잡는다.
const MAX_REPAIR_LIMIT = 100
const DEFAULT_REPAIR_LIMIT = 20

interface WorkerRequestBody {
  mode: 'worker' | 'consistency' | 'backfill' | 'repair'
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
  if (
    body.mode !== 'worker' && body.mode !== 'consistency'
    && body.mode !== 'backfill' && body.mode !== 'repair'
  ) return null

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
  // consistency/backfill은 도메인이 없으면 대상 자체가 정의되지 않는다. repair는 도메인 무관(전역 스캔).
  if ((parsed.mode === 'consistency' || parsed.mode === 'backfill') && !parsed.domain) return null
  return parsed
}

interface RepairRow {
  id: string
  content: string
}

function isRepairRow(value: unknown): value is RepairRow {
  return (
    typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>).id === 'string'
    && typeof (value as Record<string, unknown>).content === 'string'
  )
}

/**
 * embedding is null 인 행만 골라 재임베딩한다(0085 클로버 방지의 짝 — 이미 null이 된 행 복구).
 * 성공한 것만 UPDATE 한다. 실패는 다음 호출을 위해 null인 채로 둔다(에러 처리 3원칙: 위장 금지).
 */
async function runRepairOnce(
  admin: SupabaseKnowledgeClient,
  limit: number,
): Promise<{ scanned: number; repaired: number; stillNull: number } | { error: string; status: number }> {
  const { data, error } = await admin
    .from('ai_documents')
    .select('id, content')
    .is('embedding', null)
    .limit(limit)
  if (error) return { error: 'null 임베딩 행을 조회하지 못했습니다.', status: 503 }
  if (!Array.isArray(data)) return { error: 'null 임베딩 행을 조회하지 못했습니다.', status: 503 }
  const rows = data.filter(isRepairRow)
  if (rows.length === 0) return { scanned: 0, repaired: 0, stillNull: 0 }

  const vectors = await embedDocuments(rows.map(row => row.content), 'RETRIEVAL_DOCUMENT')
  if (vectors === null) {
    // 키가 없어 호출 자체를 못 한 경우 — 전부 미복구로 정직하게 보고한다.
    return { scanned: rows.length, repaired: 0, stillNull: rows.length }
  }

  let repaired = 0
  for (let i = 0; i < rows.length; i++) {
    const vector = vectors[i]
    if (!vector) continue // 실패한 항목은 건드리지 않는다 — null 유지
    const { error: updateError } = await admin
      .from('ai_documents')
      .update({ embedding: vector })
      .eq('id', rows[i].id)
    if (!updateError) repaired++
  }
  return { scanned: rows.length, repaired, stillNull: rows.length - repaired }
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

    if (body.mode === 'repair') {
      const limit = Math.min(body.batchSize ?? DEFAULT_REPAIR_LIMIT, MAX_REPAIR_LIMIT)
      const result = await runRepairOnce(admin, limit)
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json({ mode: 'repair', ...result })
    }

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
