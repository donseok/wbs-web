import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runWikiWorkerOnce } from '@/lib/ai/wiki-ingest'

export const dynamic = 'force-dynamic'

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function workerEnabled(): boolean {
  return process.env.WIKI_WORKER_ENABLED === 'true'
}

async function runWorker(limit: number): Promise<NextResponse> {
  try {
    return NextResponse.json(await runWikiWorkerOnce(limit))
  } catch (error) {
    console.error('[wiki] worker 실행 실패:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Wiki 처리 작업 실행에 실패했습니다.' }, { status: 500 })
  }
}

/**
 * 실패/지연된 Wiki 처리 작업 재시도용 보호 라우트.
 * - GET: Vercel Cron이 CRON_SECRET을 Authorization Bearer로 전달한다.
 * - POST: 운영자가 WIKI_WORKER_SECRET을 x-cron-secret으로 보내 수동 재시도한다.
 * 비활성 또는 시크릿 미설정 시 존재를 404로 숨긴다.
 */
export async function POST(req: NextRequest) {
  if (!workerEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }
  const secret = process.env.WIKI_WORKER_SECRET
  if (!secret) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  if (!secretMatches(req.headers.get('x-cron-secret'), secret)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  let limit = 5
  try {
    const body = await req.json() as unknown
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const requested = (body as Record<string, unknown>).limit
      if (requested !== undefined) {
        if (!Number.isInteger(requested) || Number(requested) < 1 || Number(requested) > 20) {
          return NextResponse.json({ error: 'limit은 1~20 정수여야 합니다.' }, { status: 400 })
        }
        limit = requested as number
      }
    }
  } catch {
    // 빈 body는 기본 limit으로 실행한다.
  }

  return runWorker(limit)
}

export async function GET(req: NextRequest) {
  if (!workerEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const authorization = req.headers.get('authorization')
  if (!secretMatches(
    authorization?.startsWith('Bearer ') ? authorization.slice(7) : null,
    secret,
  )) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  return runWorker(10)
}
