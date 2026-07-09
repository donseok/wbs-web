import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sanitizeHistory } from '@/lib/ai/answer'
import { streamDocAnswer, streamArchiveAnswer } from '@/lib/ai/minutes-answer'
import { TEAM_CODES } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 회의록 Q&A 스트리밍(text/plain). mode=doc(문서 전문) | archive(RAG+키워드). */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: {
    mode?: unknown; minuteId?: unknown; message?: unknown; history?: unknown
    filters?: { team?: unknown; from?: unknown; to?: unknown }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })
  const history = sanitizeHistory(body.history)
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  }

  try {
    if (body.mode === 'doc') {
      const minuteId = typeof body.minuteId === 'string' ? body.minuteId : ''
      if (!minuteId) return NextResponse.json({ error: 'minuteId가 필요합니다.' }, { status: 400 })
      const stream = await streamDocAnswer({ minuteId, message, history })
      if (!stream) return NextResponse.json({ error: '회의록을 찾을 수 없습니다.' }, { status: 404 })
      return new Response(stream, { headers })
    }
    if (body.mode === 'archive') {
      const f = body.filters ?? {}
      const team = typeof f.team === 'string' && (TEAM_CODES as string[]).includes(f.team)
        ? (f.team as TeamCode) : null
      const from = typeof f.from === 'string' && DATE_RE.test(f.from) ? f.from : null
      const to = typeof f.to === 'string' && DATE_RE.test(f.to) ? f.to : null
      const stream = await streamArchiveAnswer({ message, history, filters: { team, from, to } })
      return new Response(stream, { headers })
    }
    return NextResponse.json({ error: 'mode 는 doc|archive 여야 합니다.' }, { status: 400 })
  } catch (e) {
    console.error('[minutes] /api/minutes/chat 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
