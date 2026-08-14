import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import { createSupabaseWikiRepository } from '@/lib/repositories/supabase/wiki'
import { wikiTopicHref } from '@/lib/ai/chat/deep-links'
import { ilikeOrPattern } from '@/lib/domain/minutes'
import { wikiAskTokens } from '@/lib/domain/wikiAsk'
import type { BotSource } from '@/lib/ai/chat/protocol'
import type { WikiKnowledgeRecord } from '@/lib/repositories/types'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 16_384
const MAX_QUESTION = 2_000
const RESULT_LIMIT = 8
const DOCUMENT_SCAN_LIMIT = 80
const MAX_ANSWER_ENTRIES = 8

function kindFromQuestion(question: string): string | null {
  if (/결정|합의|결론|확정|\b(?:decision|decisions|agreed|agreement|agreements|confirmed)\b/i.test(question)) return 'decision'
  if (/리스크|위험|\b(?:risk|risks|hazard|hazards)\b/i.test(question)) return 'risk'
  if (/액션|할\s*일|조치|담당|\b(?:action|actions|task|tasks|owner|owners)\b/i.test(question)) return 'action'
  if (/미답|열린\s*질문|해결되지\s*않은\s*질문|\b(?:(?:open|unanswered|unresolved|remaining)\s+questions?|questions?\s+(?:remain|remaining|open))\b/i.test(question)) return 'question'
  return null
}

function isRecentQuestion(question: string): boolean {
  return /최근.{0,12}(?:변경|바뀐|업데이트)|(?:변경|바뀐|업데이트).{0,12}최근|\b(?:what\s+changed|recent\s+(?:changes?|updates?)|changed\s+recently|updated\s+recently)\b/i.test(question)
}

function score(record: WikiKnowledgeRecord, tokens: string[]): number {
  const statement = record.statement.toLocaleLowerCase()
  const title = record.topicTitle.toLocaleLowerCase()
  let value = record.lifecycleState === 'conflicted' ? -2 : 0
  for (const token of tokens) {
    const needle = token.toLocaleLowerCase()
    if (title.includes(needle)) value += 4
    if (statement.includes(needle)) value += 2
  }
  if (record.kind === 'decision' && record.decisionState === 'confirmed') value += 1
  return value
}

type WikiDocumentHit = {
  id: string
  title: string
  bodyMd: string
  updatedAt: string
  verifiedAt: string | null
  reviewDueAt: string | null
  score: number
}

type WikiQuestionHit = {
  id: string
  topicId: string | null
  question: string
  answer: string
  updatedAt: string
  score: number
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function documentExcerpt(bodyMd: string, tokens: string[]): string {
  const paragraphs = bodyMd
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n\s*\n|\n(?=#{1,6}\s)/)
    .map((part) => part
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
  const ranked = paragraphs.map((paragraph, index) => ({
    paragraph,
    index,
    hits: tokens.filter((token) => paragraph.toLocaleLowerCase().includes(token.toLocaleLowerCase())).length,
  })).sort((left, right) => right.hits - left.hits || left.index - right.index)
  const excerpt = ranked[0]?.paragraph ?? ''
  return excerpt.length > 320 ? `${excerpt.slice(0, 317).trimEnd()}…` : excerpt
}

async function searchWikiDocuments(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  tokens: string[],
  documentKind: string | null = null,
): Promise<{ items: WikiDocumentHit[]; truncated: boolean }> {
  let request = sb.from('wiki_topics')
    .select('id, title, body_md, body_updated_at, updated_at, verified_at, review_due_at, document_kind')
    .eq('project_id', projectId)
    .not('body_md', 'is', null)
  if (documentKind) request = request.eq('document_kind', documentKind)
  if (tokens.length > 0) {
    request = request.or(tokens.flatMap((token) => {
      const pattern = ilikeOrPattern(token)
      return [`title.ilike.${pattern}`, `body_md.ilike.${pattern}`]
    }).join(','))
  }
  const { data, error } = await request
    .order('body_updated_at', { ascending: false, nullsFirst: false })
    .limit(DOCUMENT_SCAN_LIMIT + 1)
  if (error) {
    // 0079 배포 전에도 기존 회의 기반 지식 검색은 계속 제공한다.
    const message = error.message?.toLowerCase() ?? ''
    const schemaMissing = ['PGRST204', '42703'].includes(error.code ?? '')
      && ['body_md', 'body_updated_at', 'verified_at', 'review_due_at', 'document_kind'].some((name) => message.includes(name))
    if (!schemaMissing) console.error('[wiki-ask] 문서 검색 실패(근거 항목 검색은 계속):', error.message)
    // 스키마 미적용은 '아직 문서가 없는 환경'이라 빈 결과가 사실이다. 그러나 진짜 조회
    // 실패까지 빈 결과로 돌려주면 "위키에 그 문서가 없다"로 읽힌다 — 에러 3원칙 ①.
    // truncated 로 올려 답변이 불완전함을 화면까지 전파한다.
    return { items: [], truncated: !schemaMissing }
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const now = Date.now()
  const items = rows.slice(0, DOCUMENT_SCAN_LIMIT).flatMap((row): WikiDocumentHit[] => {
    const id = typeof row.id === 'string' ? row.id : ''
    const title = typeof row.title === 'string' ? row.title : ''
    const bodyMd = typeof row.body_md === 'string' ? row.body_md.trim() : ''
    if (!id || !title || !bodyMd) return []
    const verifiedAt = nullableString(row.verified_at)
    const reviewDueAt = nullableString(row.review_due_at)
    const lowerTitle = title.toLocaleLowerCase()
    const lowerBody = bodyMd.toLocaleLowerCase()
    const tokenScore = tokens.reduce((total, token) => {
      const needle = token.toLocaleLowerCase()
      return total + (lowerTitle.includes(needle) ? 5 : 0) + (lowerBody.includes(needle) ? 2 : 0)
    }, 0)
    const currentlyVerified = Boolean(verifiedAt)
      && (!reviewDueAt || !Number.isFinite(Date.parse(reviewDueAt)) || Date.parse(reviewDueAt) > now)
    return [{
      id,
      title,
      bodyMd,
      updatedAt: nullableString(row.body_updated_at) ?? nullableString(row.updated_at) ?? '',
      verifiedAt,
      reviewDueAt,
      score: tokenScore + (currentlyVerified ? 6 : 0),
    }]
  }).sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
  return { items, truncated: rows.length > DOCUMENT_SCAN_LIMIT }
}

async function searchAnsweredQuestions(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  tokens: string[],
): Promise<{ items: WikiQuestionHit[]; truncated: boolean }> {
  let request = sb.from('wiki_questions')
    .select('id, topic_id, question, answer, updated_at')
    .eq('project_id', projectId)
    .eq('status', 'answered')
    .not('answer', 'is', null)
  if (tokens.length > 0) {
    request = request.or(tokens.flatMap((token) => {
      const pattern = ilikeOrPattern(token)
      return [`question.ilike.${pattern}`, `answer.ilike.${pattern}`]
    }).join(','))
  }
  const { data, error } = await request.order('updated_at', { ascending: false }).limit(21)
  if (error) {
    const message = error.message?.toLowerCase() ?? ''
    const schemaMissing = error.code === '42P01'
      || error.code === 'PGRST205'
      || message.includes('wiki_questions') && message.includes('does not exist')
    if (!schemaMissing) console.error('[wiki-ask] 답변 지식 검색 실패(다른 근거 검색은 계속):', error.message)
    // 위 searchWikiDocuments 와 같은 이유 — 실패를 '결과 없음'으로 위장하지 않는다.
    return { items: [], truncated: !schemaMissing }
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const items = rows.slice(0, 20).flatMap((row): WikiQuestionHit[] => {
    const id = typeof row.id === 'string' ? row.id : ''
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (!id || !question || !answer) return []
    const lowerQuestion = question.toLocaleLowerCase()
    const lowerAnswer = answer.toLocaleLowerCase()
    const tokenScore = tokens.reduce((total, token) => {
      const needle = token.toLocaleLowerCase()
      return total + (lowerQuestion.includes(needle) ? 4 : 0) + (lowerAnswer.includes(needle) ? 2 : 0)
    }, 0)
    return [{
      id,
      topicId: nullableString(row.topic_id),
      question,
      answer,
      updatedAt: nullableString(row.updated_at) ?? '',
      score: tokenScore,
    }]
  }).sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)
  return { items, truncated: rows.length > 20 }
}

function sourceForRecord(projectId: string, record: WikiKnowledgeRecord): BotSource {
  return {
    id: `wiki:${record.id}`,
    domain: 'wiki',
    entityType: 'wiki_item',
    entityId: record.id,
    projectId,
    title: record.topicTitle || record.statement.slice(0, 60),
    href: wikiTopicHref(projectId, record.topicId),
    updatedAt: record.updatedAt,
    ...(record.evidenceExcerpt ? { excerpt: record.evidenceExcerpt } : {}),
  }
}

function sourceForDocument(projectId: string, document: WikiDocumentHit): BotSource {
  return {
    id: `wiki-topic:${document.id}`,
    domain: 'wiki',
    entityType: 'wiki_topic',
    entityId: document.id,
    projectId,
    title: document.title,
    href: wikiTopicHref(projectId, document.id),
    updatedAt: document.updatedAt || null,
    excerpt: documentExcerpt(document.bodyMd, []),
  }
}

function sourceForQuestion(projectId: string, question: WikiQuestionHit): BotSource {
  return {
    id: `wiki-question:${question.id}`,
    domain: 'wiki',
    entityType: 'wiki_question',
    entityId: question.id,
    projectId,
    title: question.question,
    // 답변된 Q&A는 주제 상세의 열린 질문 목록에는 나타나지 않는다. 홈에 선택 id를
    // 넘기면 최신 10건 밖의 답변도 반드시 렌더되어 source 링크가 빈 앵커가 되지 않는다.
    href: `/p/${projectId}/wiki?question=${encodeURIComponent(question.id)}#wiki-question-${question.id}`,
    updatedAt: question.updatedAt || null,
    excerpt: question.answer.slice(0, 300),
  }
}

function knowledgeStatus(record: WikiKnowledgeRecord): string {
  if (record.lifecycleState === 'conflicted') return '[상충 확인 필요]'
  if (record.certainty === 'tentative' || ['proposed', 'tentative'].includes(record.decisionState ?? '')) return '[잠정]'
  if (record.lifecycleState === 'open') return '[열림]'
  return '[현재 유효]'
}

/** Chat v2가 비활성인 환경에서도 출처 있는 현재 지식을 돌려주는 결정형 Ask 폴백. */
export async function POST(req: NextRequest) {
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: '요청이 너무 큽니다.' }, { status: 413 })
  }
  const user = await getSession()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const body = await req.json().catch(() => null) as { projectId?: unknown; question?: unknown } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!projectId || !question || question.length > MAX_QUESTION) {
    return NextResponse.json({ error: '프로젝트와 질문을 확인해 주세요.' }, { status: 400 })
  }

  const sb = await createServerClient()
  const scope = await createSupabaseAccessScopeResolver(sb).resolve(user.id)
  if (!scope.ok) {
    return NextResponse.json({ error: '프로젝트 접근 범위를 확인하지 못했습니다.' }, { status: 503 })
  }
  if (!scope.scope.allowedProjectIds.includes(projectId)) {
    return NextResponse.json({ error: '이 프로젝트를 조회할 수 없습니다.' }, { status: 403 })
  }

  const repository = createSupabaseWikiRepository(sb)
  const kind = kindFromQuestion(question)
  const recent = isRecentQuestion(question)
  const tokens = wikiAskTokens(question)
  // 의미 토큰도 지원 intent도 없는 짧은 질문에는 최신 문서를 임의 답변으로 내놓지 않는다.
  if (tokens.length === 0 && !kind && !recent) {
    return NextResponse.json({
      answer: '', sources: [], asOf: new Date().toISOString(), truncated: false, grounded: false,
    })
  }

  // 유형만 물으면 최신 해당 유형을, 구체 명사가 있으면 관련 결과만 조회한다. 최근 변경
  // intent는 업데이트 시각 기준 최신 문서·지식으로 명시적으로 라우팅한다.
  const queries: Array<string | null> = recent || (kind && tokens.length === 0) ? [null] : [question]
  const shouldSearchDocuments = recent || tokens.length > 0 || kind === 'decision'
  const shouldSearchAnsweredQuestions = recent || (kind !== 'question' && tokens.length > 0)
  const [documents, answeredQuestions, results] = await Promise.all([
    shouldSearchDocuments
      ? searchWikiDocuments(sb, projectId, recent ? [] : tokens, kind === 'decision' && tokens.length === 0 ? 'decision' : null)
      : Promise.resolve({ items: [], truncated: false }),
    shouldSearchAnsweredQuestions
      ? searchAnsweredQuestions(sb, projectId, recent ? [] : tokens)
      : Promise.resolve({ items: [], truncated: false }),
    Promise.all(queries.map(query => repository.searchWikiKnowledge({
      projectId,
      query,
      kind,
      limit: RESULT_LIMIT,
    }))),
  ])
  const failed = results.find(result => !result.ok)
  if (failed && !failed.ok) {
    return NextResponse.json({ error: '프로젝트 Wiki를 조회하지 못했습니다.' }, { status: 503 })
  }

  const byId = new Map<string, WikiKnowledgeRecord>()
  let truncated = documents.truncated || answeredQuestions.truncated
  for (const result of results) {
    if (!result.ok) continue
    truncated ||= result.data.scanTruncated
    for (const item of result.data.items) byId.set(item.id, item)
  }
  const records = [...byId.values()]
    .sort((left, right) => score(right, tokens) - score(left, tokens)
      || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RESULT_LIMIT)

  const candidates: Array<{ line: string; source: BotSource }> = []
  for (const document of documents.items) {
    const dueAt = document.reviewDueAt ? Date.parse(document.reviewDueAt) : Number.NaN
    const verified = Boolean(document.verifiedAt) && (!Number.isFinite(dueAt) || dueAt > Date.now())
    candidates.push({
      line: `${verified ? '[검증됨]' : '[검증 필요]'} ${document.title}: ${documentExcerpt(document.bodyMd, tokens)}`,
      source: sourceForDocument(projectId, document),
    })
  }
  for (const answeredQuestion of answeredQuestions.items) {
    candidates.push({
      line: `[답변 완료] ${answeredQuestion.question}: ${answeredQuestion.answer}`,
      source: sourceForQuestion(projectId, answeredQuestion),
    })
  }
  for (const record of records) {
    candidates.push({
      line: `${knowledgeStatus(record)} ${record.statement} (${record.topicTitle || '주제 미지정'})`,
      source: sourceForRecord(projectId, record),
    })
  }
  const entries = candidates.slice(0, MAX_ANSWER_ENTRIES)
  const answer = entries.length > 0
    ? [
        recent ? '최근 업데이트된 프로젝트 Wiki 내용입니다.' : '프로젝트 Wiki에서 다음 내용을 찾았습니다.',
        '',
        ...entries.map((entry, index) => `• [${index + 1}] ${entry.line}`),
      ].join('\n')
    : ''

  return NextResponse.json({
    answer,
    // 답변 bullet과 표시 가능한 출처를 같은 순서·개수로 1:1 바인딩한다. 회의록 원문은
    // Wiki 항목 상세의 보조 근거 링크로 남겨 한 답변 때문에 출처 cap을 잠식하지 않는다.
    sources: entries.map((entry, index) => ({
      ...entry.source,
      title: `[${index + 1}] ${entry.source.title}`,
    })),
    asOf: new Date().toISOString(),
    truncated,
    grounded: entries.length > 0,
  })
}
