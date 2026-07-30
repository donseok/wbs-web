import { NextRequest, NextResponse } from 'next/server'
import { requireSuperuser } from '@/lib/authz'
import { ingestProject } from '@/lib/ai/ingest'

export const dynamic = 'force-dynamic'

/** 가드 실패 → HTTP status. 비로그인 401 · 권한 없음 403 · 권한 조회 실패는 서버 문제라 500(라우트 관례). */
function denyStatus(error: string): number {
  if (error === '로그인 필요') return 401
  return error === '권한 없음' ? 403 : 500
}

export async function POST(req: NextRequest) {
  const g = await requireSuperuser()
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: denyStatus(g.error) })

  let body: { projectId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'projectId 가 필요합니다.' }, { status: 400 })

  try {
    const result = await ingestProject(projectId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[dkbot] /api/chat/reindex 오류:', e)
    return NextResponse.json({ error: '색인에 실패했습니다.' }, { status: 500 })
  }
}
