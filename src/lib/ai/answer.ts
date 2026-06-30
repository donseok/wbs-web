import { classifyIntent, needsSemantic, isCrossProject } from './intent'
import { gatherKnowledge } from './knowledge'
import { retrieveContext, type Match } from './retrieve'
import { generateAnswer, generateAnswerStream, type ChatMessage } from './llm'
import { hasLLM } from './provider'

export interface AnswerInput {
  projectId: string | null
  message: string
  history: ChatMessage[]
}

export interface AnswerResult {
  answer: string
  intent: string
  usedLLM: boolean
  sources: { kind: string; refId: string | null; similarity: number }[]
}

const SYSTEM = `너는 'DK Bot', 프로젝트 관리 도구 D'Flow 의 AI 어시스턴트야.
사용자의 프로젝트·작업(WBS) 데이터에 대해 한국어로 친근하고 간결하게 답한다.

규칙:
- 아래 [데이터]에 있는 사실과 숫자만 근거로 답한다. [데이터]에 없는 내용은 모른다고 말하고 추측하지 않는다.
- 작업 수·공정률·지연일 등 숫자는 [데이터]의 값을 그대로 사용한다. 임의로 만들지 않는다.
- 핵심부터 말하고, 항목이 여러 개면 간단한 불릿(•)으로 정리한다.
- 군더더기 없이 필요한 만큼만. 과한 인사·사과는 생략한다.`

export async function answerQuestion(input: AnswerInput): Promise<AnswerResult> {
  const message = input.message.trim()
  const intent = classifyIntent(message)
  const knowledge = await gatherKnowledge(intent, input.projectId)

  let matches: Match[] = []
  if (needsSemantic(intent)) {
    const scope = isCrossProject(intent) ? null : knowledge.scopeProjectId
    matches = await retrieveContext(message, scope, 8)
  }

  const sources = matches.map(m => ({
    kind: m.kind,
    refId: m.refId,
    similarity: Math.round(m.similarity * 100) / 100,
  }))

  if (hasLLM()) {
    const system = `${SYSTEM}\n\n[데이터]\n${buildDataBlock(knowledge.text, matches)}`
    const llm = await generateAnswer(system, [...trimHistory(input.history), { role: 'user', content: message }])
    if (llm) return { answer: llm, intent, usedLLM: true, sources }
  }

  // LLM 미설정/실패 → 결정형 폴백 (항상 동작)
  return { answer: deterministicAnswer(knowledge.text, matches, intent), intent, usedLLM: false, sources }
}

function buildDataBlock(text: string, matches: Match[]): string {
  if (!matches.length) return text
  return `${text}\n\n[관련 작업(의미검색)]\n${matches.map(m => m.content).join('\n---\n')}`
}

function deterministicAnswer(text: string, matches: Match[], intent: string): string {
  if (intent !== 'freeform') return text
  const parts = [text]
  if (matches.length) {
    parts.push('\n질문과 관련 있어 보이는 작업이에요:')
    parts.push(matches.slice(0, 5).map(m => `• ${m.content.split('\n')[0]}`).join('\n'))
  }
  parts.push(
    '\n더 정확히 답하려면 "지연된 작업", "이번 주 작업", "멤버별 업무", "완료된 작업", "주간 요약"처럼 물어봐 주세요.',
  )
  return parts.join('\n')
}

function trimHistory(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-8)
}

/** 동일 파이프라인을 토큰 스트리밍으로. LLM 키가 있으면 토큰 단위, 없으면 결정형 답변을 단일 청크로 흘려보낸다. */
export async function streamAnswer(input: AnswerInput): Promise<ReadableStream<Uint8Array>> {
  const message = input.message.trim()
  const intent = classifyIntent(message)
  const knowledge = await gatherKnowledge(intent, input.projectId)

  let matches: Match[] = []
  if (needsSemantic(intent)) {
    matches = await retrieveContext(message, isCrossProject(intent) ? null : knowledge.scopeProjectId, 8)
  }

  const enc = new TextEncoder()
  const fallback = () => deterministicAnswer(knowledge.text, matches, intent)

  if (hasLLM()) {
    const system = `${SYSTEM}\n\n[데이터]\n${buildDataBlock(knowledge.text, matches)}`
    const iter = await generateAnswerStream(system, [...trimHistory(input.history), { role: 'user', content: message }])
    if (iter) {
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          let any = false
          try {
            for await (const chunk of iter) {
              any = true
              controller.enqueue(enc.encode(chunk))
            }
          } catch (e) {
            console.error('[dkbot] 스트리밍 오류:', e)
            // 토큰을 일부 내보낸 뒤 끊긴 경우: 잘린 답변을 완성본으로 오인하지 않도록 명시 마커를 덧붙인다.
            if (any) controller.enqueue(enc.encode('\n\n⚠ 답변이 도중에 끊겼어요. 다시 시도해 주세요.'))
          }
          if (!any) controller.enqueue(enc.encode(fallback())) // 토큰 0개(키/네트워크 실패) → 결정형 폴백
          controller.close()
        },
      })
    }
  }

  // LLM 미설정 → 결정형 답변 단일 청크
  const text = fallback()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

/** 요청 본문의 history 를 안전한 ChatMessage[] 로 정규화(라우트 공용). */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (m && typeof m === 'object' && 'role' in m && 'content' in m) {
      const role = (m as { role: unknown }).role
      const content = (m as { content: unknown }).content
      if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
        out.push({ role, content: content.slice(0, 4000) })
      }
    }
  }
  return out.slice(-12)
}
