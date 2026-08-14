import { NextRequest, NextResponse } from 'next/server'
import { requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  INDEX_BACKFILL_DOMAINS,
  createSupabaseIndexContentLoader,
  createSupabaseIndexJobQueue,
  createSupabaseIndexSourceLister,
  createSupabasePgvectorKnowledgeIndex,
  runIndexBackfill,
  runIndexWorkerOnce,
  runRepairOnce,
  type SupabaseKnowledgeClient,
} from '@/lib/ai/index'

export const dynamic = 'force-dynamic'

// 사용자 요구가 자동/매일 유지보수에서 "필요할 때 버튼으로 수동 갱신"으로 바뀌었다.
// 크론 시크릿 라우트(/api/chat/index/worker)는 브라우저에서 부를 수 없어 이 세션 인가
// 라우트를 별도로 둔다. 조립(queue·index·loadContent)과 repair 로직은 그대로 재사용한다.

const STEP_BATCH_SIZE = 8
const REPAIR_LIMIT = 20

type ReindexAction = 'status' | 'enqueue' | 'step' | 'repair'

/** requireSuperuser() 의 세 에러 문자열만 안다 — 그 외(알 수 없는 실패)는 판정 불가로 503. */
function denyStatus(error: string): 401 | 403 | 503 {
  if (error === '로그인 필요') return 401
  if (error === '권한 없음') return 403
  return 503
}

function parseAction(raw: unknown): ReindexAction | null {
  if (!raw || typeof raw !== 'object') return null
  const action = (raw as Record<string, unknown>).action
  return action === 'status' || action === 'enqueue' || action === 'step' || action === 'repair' ? action : null
}

/** 워커 라우트와 동일한 accessScope 조립 — 실제 프로젝트 전체 + global. */
async function loadAccessScope(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ allowedProjectIds: string[]; allowGlobal: true } | null> {
  const projectsResult = await admin.from('projects').select('id').limit(100)
  if (projectsResult.error || !Array.isArray(projectsResult.data)) return null
  const allowedProjectIds = (projectsResult.data as Array<{ id?: unknown }>)
    .map(row => (typeof row.id === 'string' ? row.id : ''))
    .filter(Boolean)
  return { allowedProjectIds, allowGlobal: true }
}

export async function POST(req: NextRequest) {
  // 크론 시크릿이 아니라 세션 인가다 — 브라우저에서 부르는 버튼이라서다.
  const guard = await requireSuperuser()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: denyStatus(guard.error) })

  const raw = await req.json().catch(() => null)
  const action = parseAction(raw)
  if (!action) return NextResponse.json({ error: '알 수 없는 action 입니다.' }, { status: 400 })

  const admin = createAdminClient()

  try {
    if (action === 'status') {
      const [pending, deadLetter, docs, chunks, embedded] = await Promise.all([
        admin.from('ai_index_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        admin.from('ai_index_jobs').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter'),
        // ai_documents 는 문서당 chunk_no=0 행이 정확히 하나다(consistency.ts 의 대표행 관례) — 그걸로 문서 수를 센다.
        admin.from('ai_documents').select('id', { count: 'exact', head: true }).eq('chunk_no', 0),
        admin.from('ai_documents').select('id', { count: 'exact', head: true }),
        admin.from('ai_documents').select('id', { count: 'exact', head: true }).not('embedding', 'is', null),
      ])
      const results = [pending, deadLetter, docs, chunks, embedded]
      // 조회 실패를 0건으로 위장하지 않는다(에러 처리 3원칙) — count 가 null 이면 실패다.
      if (results.some(r => r.error || typeof r.count !== 'number')) {
        return NextResponse.json({ error: '색인 현황을 조회하지 못했습니다.' }, { status: 503 })
      }
      return NextResponse.json({
        pending: pending.count, deadLetter: deadLetter.count,
        docs: docs.count, chunks: chunks.count, embedded: embedded.count,
      })
    }

    const scopedAdmin = admin as unknown as SupabaseKnowledgeClient

    if (action === 'repair') {
      const result = await runRepairOnce(scopedAdmin, REPAIR_LIMIT)
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json(result)
    }

    // enqueue/step 은 프로젝트 스코프가 필요하다 — 워커 라우트와 동일하게 조립.
    const accessScope = await loadAccessScope(admin)
    if (!accessScope) return NextResponse.json({ error: '프로젝트 범위를 확인하지 못했습니다.' }, { status: 503 })
    const queue = createSupabaseIndexJobQueue(scopedAdmin, accessScope)

    if (action === 'enqueue') {
      let enqueued = 0
      for (const domain of INDEX_BACKFILL_DOMAINS) {
        const summary = await runIndexBackfill({
          domain,
          list: createSupabaseIndexSourceLister(scopedAdmin),
          enqueue: mutations => queue.enqueue(mutations),
        })
        // 도메인 하나라도 조회/큐잉이 실패하면 부분 합계를 성공으로 위장하지 않는다.
        if (summary.listErrorCode || summary.enqueueErrorCode) {
          return NextResponse.json({ error: '색인 대상을 큐에 넣지 못했습니다.' }, { status: 503 })
        }
        enqueued += summary.enqueued
      }
      return NextResponse.json({ enqueued })
    }

    // action === 'step'
    const summary = await runIndexWorkerOnce({
      queue,
      index: createSupabasePgvectorKnowledgeIndex(scopedAdmin, accessScope),
      loadContent: createSupabaseIndexContentLoader(scopedAdmin),
      batchSize: STEP_BATCH_SIZE,
    })
    return NextResponse.json(summary)
  } catch (e) {
    console.error('[wiki] /api/wiki/reindex 오류:', e)
    return NextResponse.json({ error: '재색인 작업에 실패했습니다.' }, { status: 500 })
  }
}
