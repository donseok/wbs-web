import { describe, expect, it, vi } from 'vitest'
import {
  consumeChatNdjson,
  isSafeInternalBotHref,
  parseChatStreamLine,
} from '@/components/chat/chatStream'
import type { ChatStreamEvent } from '@/lib/ai/chat/protocol'

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('DK Bot NDJSON 소비기', () => {
  it('청크와 줄 경계가 달라도 이벤트를 순서대로 소비한다', async () => {
    const seen: ChatStreamEvent[] = []
    const stream = chunkedStream([
      '{"v":1,"requestId":"r1","type":"status","message":"확인 중"}\n',
      '{"v":1,"requestId":"r1","type":"delta","text":"답',
      '변"}\n{"v":1,"requestId":"r1","type":"done","asOf":"2026-07-19T10:30:00+09:00","tools":[],"truncated":false}\n',
    ])

    const terminal = await consumeChatNdjson(stream, event => seen.push(event))

    expect(seen.map(event => event.type)).toEqual(['status', 'delta', 'done'])
    expect(seen[1]).toMatchObject({ type: 'delta', text: '답변' })
    expect(terminal.type).toBe('done')
  })

  it('같은 프로토콜의 알 수 없는 이벤트는 무시한다', async () => {
    const onEvent = vi.fn()
    const stream = chunkedStream([
      '{"v":1,"requestId":"r1","type":"future","value":1}\n',
      '{"v":1,"requestId":"r1","type":"done","asOf":"now","tools":[],"truncated":false}',
    ])

    await consumeChatNdjson(stream, onEvent)

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'done' })
  })

  it('지원하지 않는 버전과 terminal 없는 스트림을 거부한다', async () => {
    expect(() => parseChatStreamLine('{"v":2,"requestId":"r1","type":"delta","text":"x"}'))
      .toThrow('지원하지 않는')

    await expect(consumeChatNdjson(
      chunkedStream(['{"v":1,"requestId":"r1","type":"delta","text":"x"}\n']),
      () => undefined,
    )).rejects.toThrow('완료되지 않았습니다')
  })

  it('한 스트림에 서로 다른 요청 ID가 섞이면 거부한다', async () => {
    await expect(consumeChatNdjson(
      chunkedStream([
        '{"v":1,"requestId":"r1","type":"delta","text":"x"}\n',
        '{"v":1,"requestId":"r2","type":"done","asOf":"now","tools":[],"truncated":false}\n',
      ]),
      () => undefined,
    )).rejects.toThrow('요청 ID가 일치하지 않습니다')
  })

  it('단일 슬래시 내부 출처만 허용한다', () => {
    expect(isSafeInternalBotHref('/p/project/wbs?focus=item')).toBe(true)
    expect(isSafeInternalBotHref('//evil.example/path')).toBe(false)
    expect(isSafeInternalBotHref('/\\evil.example/path')).toBe(false)
    expect(isSafeInternalBotHref('/safe\nheader')).toBe(false)
    expect(isSafeInternalBotHref('https://evil.example/path')).toBe(false)
  })
})
