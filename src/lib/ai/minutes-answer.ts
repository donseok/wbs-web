import { generateAnswerStream, type ChatMessage } from './llm'
import { hasLLM, hasEmbeddings } from './provider'
import { embedTexts } from './embeddings'
import { passesSimilarity } from './similarity'
import { extractSearchKeywords } from './intent'
import { healMissingMinuteEmbeddings } from './minutes-ingest'
import { createServerClient } from '@/lib/supabase/server'
import { ilikeOrPattern } from '@/lib/domain/minutes'
import type { TeamCode } from '@/lib/domain/types'

const DOC_SYSTEM = `너는 D'Flow 의 회의록 어시스턴트야. 아래 [회의록] 본문만 근거로 한국어로 간결하게 답한다.
규칙:
- [회의록]에 없는 내용은 모른다고 말한다. 임의로 지어내지 않는다.
- 요약·결정사항·액션아이템·참석자 추출 요청에는 불릿(•)으로 구조화해 답한다.
- 날짜·숫자·담당자는 본문 표기를 그대로 사용한다.
- 핵심부터, 군더더기 없이.`

const ARCHIVE_SYSTEM = `너는 D'Flow 의 회의록 보관함 어시스턴트야. 아래 [검색된 회의록]과 [키워드 정확 일치]만 근거로 한국어로 답한다.
규칙:
- 근거에 없는 내용은 모른다고 말한다.
- 어느 회의록(일자·담당·제목)에서 나온 내용인지 밝히며 답한다.
- 여러 회의록에 걸치면 회의록별로 불릿(•)으로 정리한다.`

const DEGRADED_NOTICE = '⚠ AI 응답이 잠시 원활하지 않아 검색 결과만 알려드려요. 잠시 후 다시 물어보세요.\n\n'

const trimHistory = (h: ChatMessage[]) => h.slice(-8)

interface MinuteMatch {
  minuteId: string; content: string; minuteDate: string; teamCode: string; title: string; similarity: number
}

function sourcesFooter(rows: { minuteId: string; minuteDate: string; teamCode: string; title: string }[]): string {
  if (!rows.length) return ''
  const seen = new Set<string>()
  const lines: string[] = []
  for (const r of rows) {
    if (seen.has(r.minuteId)) continue
    seen.add(r.minuteId)
    lines.push(`- ${r.minuteDate} · ${r.teamCode} · ${r.title} (/minutes/${r.minuteId})`)
  }
  return `\n\n---\n출처:\n${lines.join('\n')}`
}

function textStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close() } })
}

/** LLM 스트림 + 폴백 + 후미(footer) 부기 — doc/archive 공용. */
function llmOrFallbackStream(
  system: string, history: ChatMessage[], message: string,
  fallbackText: string, footer: string,
): Promise<ReadableStream<Uint8Array>> {
  return (async () => {
    const enc = new TextEncoder()
    if (hasLLM()) {
      const iter = await generateAnswerStream(system, [...trimHistory(history), { role: 'user', content: message }])
      if (iter) {
        return new ReadableStream<Uint8Array>({
          async start(controller) {
            let any = false
            try {
              for await (const chunk of iter) { any = true; controller.enqueue(enc.encode(chunk)) }
            } catch (e) {
              console.error('[minutes] 스트리밍 오류:', e)
              if (any) controller.enqueue(enc.encode('\n\n⚠ 답변이 도중에 끊겼어요. 다시 시도해 주세요.'))
            }
            if (!any) controller.enqueue(enc.encode(DEGRADED_NOTICE + fallbackText))
            if (footer) controller.enqueue(enc.encode(footer))
            controller.close()
          },
        })
      }
    }
    return textStream(fallbackText + footer)
  })()
}

/** 문서 모드 — 열려 있는 회의록 전문 주입. 회의록 없음/미접근 시 null. */
export async function streamDocAnswer(input: {
  minuteId: string; message: string; history: ChatMessage[]
}): Promise<ReadableStream<Uint8Array> | null> {
  const sb = await createServerClient() // RLS 적용
  const { data: r } = await sb.from('minutes')
    .select('id, minute_date, team_code, title, body_md')
    .eq('id', input.minuteId).maybeSingle()
  if (!r) return null

  const system = `${DOC_SYSTEM}\n\n[회의록] ${r.minute_date} · ${r.team_code} · ${r.title}\n${r.body_md as string}`
  // 폴백: 문서 내 키워드 일치 줄 발췌
  const keywords = extractSearchKeywords(input.message)
  const lines = (r.body_md as string).split('\n')
  const hits = keywords.length
    ? lines.filter(l => keywords.some(k => l.toLowerCase().includes(k))).slice(0, 8)
    : []
  const fallback = hits.length
    ? `문서에서 일치하는 줄이에요:\n${hits.map(h => `• ${h.trim()}`).join('\n')}`
    : 'AI 응답을 사용할 수 없어요. 본문을 직접 확인해 주세요.'
  return llmOrFallbackStream(system, input.history, input.message, fallback, '')
}

/** 보관함 모드 — 벡터 검색 + 키워드 정확 일치, 출처 부기. */
export async function streamArchiveAnswer(input: {
  message: string; history: ChatMessage[]
  filters: { team?: TeamCode | null; from?: string | null; to?: string | null }
}): Promise<ReadableStream<Uint8Array>> {
  const sb = await createServerClient()
  await healMissingMinuteEmbeddings() // 회의록 단위 갭 회수(쿨다운·dedupe 내장, 절대 throw 안 함)

  // 1) 벡터 검색
  let matches: MinuteMatch[] = []
  if (hasEmbeddings()) {
    const vecs = await embedTexts([input.message], 'RETRIEVAL_QUERY')
    if (vecs?.[0]?.length) {
      const { data, error } = await sb.rpc('match_minute_documents', {
        query_embedding: vecs[0], match_count: 8,
        p_team: input.filters.team ?? null,
        p_date_from: input.filters.from ?? null,
        p_date_to: input.filters.to ?? null,
      })
      if (error) console.error('[minutes] match_minute_documents 실패:', error.message)
      matches = ((data as Record<string, unknown>[] | null) ?? [])
        .filter(m => passesSimilarity(m.similarity as number)) // DK Bot 검색과 동일 컷오프(similarity.ts 단일 출처)
        .map(m => ({
          minuteId: m.minute_id as string, content: m.content as string,
          minuteDate: m.minute_date as string, teamCode: m.team_code as string,
          title: m.title as string, similarity: m.similarity as number,
        }))
    }
  }

  // 2) 키워드 정확 일치(제목/본문 ILIKE) — "X 들어간 회의록" 대응
  const keywords = extractSearchKeywords(input.message)
  let keywordRows: { minuteId: string; minuteDate: string; teamCode: string; title: string }[] = []
  if (keywords.length) {
    const pat = ilikeOrPattern(keywords[0])
    let q = sb.from('minutes').select('id, minute_date, team_code, title')
      .or(`title.ilike.${pat},body_md.ilike.${pat}`)
      .order('minute_date', { ascending: false }).limit(10)
    if (input.filters.team) q = q.eq('team_code', input.filters.team)
    const { data } = await q
    keywordRows = (data ?? []).map(r => ({
      minuteId: r.id as string, minuteDate: r.minute_date as string,
      teamCode: r.team_code as string, title: r.title as string,
    }))
  }

  // 3) 컨텍스트 조립
  const blocks: string[] = []
  if (keywordRows.length) {
    blocks.push(`[키워드 정확 일치: "${keywords[0]}"]\n${keywordRows
      .map(r => `- ${r.minuteDate} · ${r.teamCode} · ${r.title}`).join('\n')}`)
  }
  if (matches.length) {
    blocks.push(`[검색된 회의록]\n${matches
      .map(m => `[회의록: ${m.minuteDate} · ${m.teamCode} · ${m.title}]\n${m.content}`).join('\n---\n')}`)
  }
  const system = `${ARCHIVE_SYSTEM}\n\n${blocks.length ? blocks.join('\n\n') : '[검색된 회의록]\n(없음)'}`

  // 4) 폴백 + 출처
  const sourceRows = [...keywordRows, ...matches]
  const footer = sourcesFooter(sourceRows)
  const fallback = sourceRows.length
    ? `관련 회의록이에요:\n${[...new Set(sourceRows.map(r => `• ${r.minuteDate} · ${r.teamCode} · ${r.title}`))].join('\n')}`
    : '관련 회의록을 찾지 못했어요. 담당·기간 필터를 넓히거나 다른 표현으로 물어보세요.'
  return llmOrFallbackStream(system, input.history, input.message, fallback, footer)
}
