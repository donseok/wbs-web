import {
  CHAT_PROTOCOL_VERSION,
  type BotSource,
  type ChatStreamEvent,
  type ChatTerminalEvent,
  type ConversationStateV1,
} from '@/lib/ai/chat/protocol'

const MAX_PENDING_LINE = 1_000_000
const UNSAFE_HREF_CHARS = /[\\\u0000-\u001F\u007F]/

/** Reject protocol-relative and browser-normalized external URLs such as `/\\evil.example`. */
export function isSafeInternalBotHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || UNSAFE_HREF_CHARS.test(href)) return false
  try {
    const base = new URL('https://dkbot.invalid')
    const resolved = new URL(href, base)
    return resolved.origin === base.origin && resolved.pathname.startsWith('/')
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: unknown): value is BotSource {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.href === 'string'
    && typeof value.domain === 'string'
    && typeof value.entityType === 'string'
    && typeof value.entityId === 'string'
    && (value.projectId === null || typeof value.projectId === 'string')
    && (value.updatedAt === null || typeof value.updatedAt === 'string')
}

function isConversationState(value: unknown): value is ConversationStateV1 {
  return isRecord(value)
    && value.version === 1
    && Array.isArray(value.lastEntities)
    && Array.isArray(value.lastDomains)
}

/** Parse and minimally validate one server event. Unknown event types are forward-compatible. */
export function parseChatStreamLine(line: string): ChatStreamEvent | null {
  const value = JSON.parse(line.replace(/^\uFEFF/, '')) as unknown
  if (!isRecord(value)) throw new Error('잘못된 채팅 스트림 이벤트입니다.')
  if (value.v !== CHAT_PROTOCOL_VERSION) throw new Error('지원하지 않는 채팅 스트림 버전입니다.')
  if (typeof value.requestId !== 'string') throw new Error('잘못된 채팅 스트림 이벤트입니다.')

  switch (value.type) {
    case 'status':
      return typeof value.message === 'string' ? value as unknown as ChatStreamEvent : null
    case 'delta':
      return typeof value.text === 'string' ? value as unknown as ChatStreamEvent : null
    case 'sources':
      return Array.isArray(value.items)
        ? { ...value, items: value.items.filter(isSource) } as unknown as ChatStreamEvent
        : null
    case 'state':
      return isConversationState(value.conversationState) ? value as unknown as ChatStreamEvent : null
    case 'done':
      return typeof value.asOf === 'string'
          && Array.isArray(value.tools)
          && value.tools.every(tool => typeof tool === 'string')
          && typeof value.truncated === 'boolean'
        ? value as unknown as ChatStreamEvent
        : null
    case 'error':
      return typeof value.code === 'string'
          && typeof value.message === 'string'
          && typeof value.retryable === 'boolean'
        ? value as unknown as ChatStreamEvent
        : null
    default:
      return null
  }
}

/** Consume chunk-split NDJSON and require exactly one terminal event. */
export async function consumeChatNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatTerminalEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let terminal: ChatTerminalEvent | null = null
  let requestId: string | null = null

  const consumeLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.trim()) return
    if (line.length > MAX_PENDING_LINE) throw new Error('채팅 스트림 이벤트가 너무 큽니다.')
    const event = parseChatStreamLine(line)
    if (!event) return
    if (requestId === null) requestId = event.requestId
    else if (event.requestId !== requestId) throw new Error('채팅 스트림 요청 ID가 일치하지 않습니다.')
    if (terminal) throw new Error('종료 이후 채팅 스트림 이벤트를 받았습니다.')
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') terminal = event
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      if (pending.length > MAX_PENDING_LINE && !pending.includes('\n')) {
        throw new Error('채팅 스트림 이벤트가 너무 큽니다.')
      }
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) consumeLine(line)
    }
    pending += decoder.decode()
    if (pending) consumeLine(pending)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  if (!terminal) throw new Error('채팅 스트림이 완료되지 않았습니다.')
  return terminal
}
