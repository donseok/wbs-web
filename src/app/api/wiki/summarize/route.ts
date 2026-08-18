import { NextResponse, type NextRequest } from 'next/server'
import { generateAnswer, type ChatMessage } from '@/lib/ai/llm'
import { getActorViewState } from '@/lib/authz'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { decideSearchAccess } from '@/lib/domain/searchAccess'
import { createAdminClient } from '@/lib/supabase/admin'

// 검색 결과 발췌 나열만으로는 "답변이 부족하다"(사용자 피드백) — 화면에 이미 떠 있는
// 결과를 그대로 근거로 넘겨 LLM 1회로 한 문단 답변을 만든다(스펙 §4 "요약 버튼", 온디맨드).
// DB 재조회 없음 — 클라이언트가 보낸 sources 만 근거로 삼는다.

const MAX_QUERY_CHARS = 200
const MAX_TITLE_CHARS = 120
const MAX_SNIPPET_CHARS = 500
const MIN_SOURCES = 1
const MAX_SOURCES = 8

interface SummarizeSource {
  n: number
  title: string
  snippet: string
  domain: string
}

interface SummarizeRequestBody {
  projectId: string
  q: string
  sources: SummarizeSource[]
}

function isValidSource(value: unknown): value is SummarizeSource {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Number.isInteger(v.n) && (v.n as number) >= 1 && (v.n as number) <= MAX_SOURCES
    && typeof v.title === 'string' && v.title.length > 0 && v.title.length <= MAX_TITLE_CHARS
    && typeof v.snippet === 'string' && v.snippet.length > 0 && v.snippet.length <= MAX_SNIPPET_CHARS
    && typeof v.domain === 'string' && v.domain.length > 0 && v.domain.length <= 64
  )
}

/** 상한 위반은 전부 400 — search 라우트처럼 자르거나 기본값으로 눙치지 않는다(클라이언트 버그를 숨기지 않음). */
function isValidBody(body: {
  q: string
  sources: unknown
}): body is { q: string; sources: SummarizeSource[] } {
  if (!body.q.trim() || body.q.length > MAX_QUERY_CHARS) return false
  if (!Array.isArray(body.sources)) return false
  if (body.sources.length < MIN_SOURCES || body.sources.length > MAX_SOURCES) return false
  return body.sources.every(isValidSource)
}

const SUMMARY_SYSTEM = `당신은 프로젝트 기록 요약자입니다. 아래 [근거]만 사용해 질문에 한국어로 답하세요.
- 문장마다 근거 번호를 [n] 형식으로 인용하세요.
- 근거에 없는 내용은 지어내지 말고 "근거에서 확인되지 않습니다"라고 답하세요.
- 3~5문장으로 간결하게 답하세요.`

function buildUserMessage(query: string, sources: SummarizeSource[]): string {
  const list = sources.map(s => `[${s.n}] (${s.domain}) ${s.title} — ${s.snippet}`).join('\n')
  return `질문: ${query}\n\n[근거]\n${list}`
}

export async function POST(request: NextRequest) {
  // getActorViewState() 는 { actor, degraded } 를 반환한다 — 조회 실패(degraded)를
  // 인증 실패(401)로 위장하지 않는다(에러 처리 3원칙).
  const { actor, degraded } = await getActorViewState()
  if (degraded) return NextResponse.json({ error: 'ACTOR_LOOKUP_FAILED' }, { status: 503 })
  if (!actor?.userId) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const raw = await request.json().catch(() => null) as
    | { projectId?: unknown; q?: unknown; sources?: unknown }
    | null
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : ''
  const q = typeof raw.q === 'string' ? raw.q : ''
  if (!isValidBody({ q, sources: raw.sources })) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }
  const body: SummarizeRequestBody = { projectId, q, sources: raw.sources as SummarizeSource[] }

  // search 라우트와 동일한 인가 관문 — ai_documents 의 RLS 는 authenticated using (true) 라
  // 여기서 막지 않으면 projectId 를 아는 로그인 사용자에게 요약이 샌다.
  const admin = createAdminClient()
  const scope = await createSupabaseAccessScopeResolver(admin).resolve(actor.userId)
  const access = decideSearchAccess(body.projectId, scope)
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.status })

  const messages: ChatMessage[] = [{ role: 'user', content: buildUserMessage(body.q, body.sources) }]
  const answer = await generateAnswer(SUMMARY_SYSTEM, messages)
  // 빈 답으로 위장하지 않는다 — LLM 실패는 503 으로 정직하게 알린다(에러 처리 3원칙).
  if (!answer) return NextResponse.json({ error: 'SUMMARY_UNAVAILABLE' }, { status: 503 })

  return NextResponse.json({ answer })
}
