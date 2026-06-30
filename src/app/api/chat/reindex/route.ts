import { NextRequest, NextResponse } from 'next/server'
import { getMembership } from '@/lib/auth'
import { ingestProject } from '@/lib/ai/ingest'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })

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
