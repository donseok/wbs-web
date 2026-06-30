import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { streamAnswer, sanitizeHistory } from '@/lib/ai/answer'

export const dynamic = 'force-dynamic'

/** 답변 토큰 스트리밍(text/plain). 본문은 /api/chat 과 동일 스키마. */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { projectId?: unknown; message?: unknown; history?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })

  const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
  const history = sanitizeHistory(body.history)

  try {
    const stream = await streamAnswer({ projectId, message, history })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    console.error('[dkbot] /api/chat/stream 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
