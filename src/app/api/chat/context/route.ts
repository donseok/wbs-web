import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { buildBotContext } from '@/lib/ai/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('projectId')
  const projectId = raw && raw !== 'null' && raw !== 'undefined' ? raw : null

  try {
    const ctx = await buildBotContext(projectId)
    return NextResponse.json(ctx)
  } catch (e) {
    console.error('[dkbot] /api/chat/context 오류:', e)
    return NextResponse.json({ error: '컨텍스트 로드에 실패했습니다.' }, { status: 500 })
  }
}
