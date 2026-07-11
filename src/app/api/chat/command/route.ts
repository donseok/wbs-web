import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getComputedWbs } from '@/lib/data/wbs'
import { runCommandPipeline } from '@/lib/ai/commands/pipeline'

export const dynamic = 'force-dynamic'

/** DkBot 쓰기 명령 파이프라인(읽기 전용 제안 생성) — 얇은 접착층. 실제 쓰기는 별도 서버 액션이 담당. */
export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  let body: { projectId?: unknown; message?: unknown; targetId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : null
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const targetId = typeof body.targetId === 'string' ? body.targetId : undefined
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }
  if (!projectId) {
    return NextResponse.json({
      kind: 'error', message: '프로젝트 화면에서만 명령을 사용할 수 있어요.',
    })
  }

  const { items } = await getComputedWbs(projectId)
  const proposal = await runCommandPipeline(message, items, targetId)
  return NextResponse.json(proposal)
}
