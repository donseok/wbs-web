import { describe, it, expect } from 'vitest'
import { drainSse } from '@/lib/ai/llm'

describe('drainSse — SSE 라인 버퍼 파서', () => {
  it('완성된 data 라인을 추출하고 부분 라인은 버퍼에 남긴다', () => {
    const { payloads, rest } = drainSse('data: {"a":1}\ndata: {"b":2}\ndata: {"c"')
    expect(payloads).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('data: {"c"') // 미완성 라인은 다음 청크와 합쳐짐
  })

  it('data 가 아닌 라인(빈 줄 등)은 무시한다', () => {
    const { payloads } = drainSse('event: message\n\ndata: hello\n')
    expect(payloads).toEqual(['hello'])
  })

  it('청크 경계로 쪼개진 라인을 rest 로 이어붙일 수 있다', () => {
    const a = drainSse('data: {"part"')
    expect(a.payloads).toEqual([])
    const b = drainSse(a.rest + ':1}\n')
    expect(b.payloads).toEqual(['{"part":1}'])
  })

  it('[DONE] 페이로드도 그대로 반환(소비측에서 걸러냄)', () => {
    const { payloads } = drainSse('data: [DONE]\n')
    expect(payloads).toEqual(['[DONE]'])
  })
})
