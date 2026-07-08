import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sanitizeHistory } from '@/lib/ai/answer'
import { generateAnswerStream } from '@/lib/ai/llm'
import { hasLLM } from '@/lib/ai/provider'
import { getMinutesDetail } from '@/lib/data/minutes'
import {
  buildMinutesSystemPrompt, isMinutesPreset, presetPrompt, truncateForContext,
} from '@/lib/ai/minutes-chat'

export const dynamic = 'force-dynamic'

const MESSAGE_MAX = 2000
const NO_LLM_NOTICE =
  'AI 답변 키가 설정되지 않아 요약·분석을 할 수 없어요. 관리자에게 GEMINI_API_KEY 설정을 요청해 주세요.'

/** api/chat/stream/route.ts 와 동일. */
const STREAM_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Accel-Buffering': 'no',
} as const

/**
 * 문서 1개 전용 챗. 문서 id 는 경로 세그먼트로 고정 — 바디로 받지 않는다.
 *
 * 바디는 `message` 와 `preset` 중 **정확히 하나**만 담는다(둘 다 오면 400).
 * 프리셋 버튼을 누른 클라이언트는 `{ preset }` 만 보내고 `message` 는 생략한다 —
 * 프리셋 문구를 message 로 함께 실어 보내면 어느 쪽이 진짜 질문인지 서버가 알 수 없다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  const { id } = await params

  let body: { message?: unknown; preset?: unknown; history?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  // isMinutesPreset 의 타입가드를 그대로 유지해 이후 presetPrompt 호출에 안전하게 좁혀 쓴다
  // ('as never' 같은 캐스트로 검증을 우회하지 않는다).
  const preset = isMinutesPreset(body.preset) ? body.preset : null
  // message 와 preset 중 정확히 하나만 허용
  if (!rawMessage && !preset) return NextResponse.json({ error: '질문을 입력하세요.' }, { status: 400 })
  if (rawMessage && preset) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  if (rawMessage.length > MESSAGE_MAX) return NextResponse.json({ error: '질문이 너무 깁니다.' }, { status: 400 })

  const question = preset ? presetPrompt(preset) : rawMessage

  // 세션 클라이언트 경유(RLS 가 접근제어) — admin 클라이언트 금지.
  const minutes = await getMinutesDetail(id)
  if (!minutes) return NextResponse.json({ error: '회의록을 찾을 수 없습니다.' }, { status: 404 })
  if (minutes.contentMd === null) {
    return NextResponse.json({ error: '이 회의록은 텍스트 원문이 없어 질문할 수 없습니다.' }, { status: 400 })
  }

  const enc = new TextEncoder()
  const single = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(text)); c.close() },
      }),
      { headers: STREAM_HEADERS },
    )

  // LLM 키가 없으면 5xx 를 던지지 않는다 — "UX 가 절대 끊기지 않음"(answer.ts:17).
  // RAG 없는 문서 챗은 결정형 폴백 답이 존재할 수 없으므로 안내 문장 하나만 흘린다.
  if (!hasLLM()) return single(NO_LLM_NOTICE)

  // projectName 은 상세 조회가 projects(name) 임베드로 함께 가져온다 — 별도 왕복 없음.
  const { text, truncated } = truncateForContext(minutes.contentMd)
  const system = buildMinutesSystemPrompt(
    {
      title: minutes.title,
      minutesDate: minutes.minutesDate,
      teamCode: minutes.teamCode,
      projectName: minutes.projectName,
    },
    text,
    truncated,
  )

  try {
    const history = sanitizeHistory(body.history)
    const iter = await generateAnswerStream(system, [...history, { role: 'user', content: question }])
    if (!iter) return single(NO_LLM_NOTICE)

    // answer.ts:139~157 의 start(controller) 블록과 동일한 구조.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let any = false
        try {
          for await (const chunk of iter) {
            any = true
            controller.enqueue(enc.encode(chunk))
          }
        } catch (e) {
          console.error('[minutes-chat] 스트리밍 오류:', e)
          // 일부 토큰을 낸 뒤 끊긴 경우: 잘린 답변을 완성본으로 오인하지 않도록 마커를 덧붙인다.
          if (any) controller.enqueue(enc.encode('\n\n⚠ 답변이 도중에 끊겼어요. 다시 시도해 주세요.'))
        }
        if (!any) controller.enqueue(enc.encode('답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.'))
        controller.close()
      },
    })
    return new Response(stream, { headers: STREAM_HEADERS })
  } catch (e) {
    console.error('[minutes-chat] 오류:', e)
    return NextResponse.json({ error: '답변 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
