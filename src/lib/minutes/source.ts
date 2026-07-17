import { isMarkableBlock, type MinuteBlock } from './blocks'

export interface MinuteSourceAnchor {
  blockIndex: number
  blockHash: string
  bodyHash: string
}

type SearchValue = string | string[] | undefined

const BLOCK_HASH_RE = /^[0-9a-f]{16}$/i
const BLOCK_INDEX_RE = /^(0|[1-9]\d*)$/

/** 대시보드 인사이트에서 회의록 원문 블록으로 이동하는 내부 링크. */
export function minuteSourceHref(minuteId: string, source: MinuteSourceAnchor): string {
  const params = new URLSearchParams({
    block: String(source.blockIndex),
    hash: source.blockHash,
    body: source.bodyHash,
  })
  return `/minutes/${minuteId}?${params.toString()}`
}

/** Next searchParams의 반복값·음수·과대 정수·잘못된 해시를 클라이언트로 넘기지 않는다. */
export function parseMinuteSourceAnchor(input: {
  block?: SearchValue
  hash?: SearchValue
  body?: SearchValue
}): MinuteSourceAnchor | null {
  if (typeof input.block !== 'string' || typeof input.hash !== 'string' || typeof input.body !== 'string') return null
  if (!BLOCK_INDEX_RE.test(input.block) || !BLOCK_HASH_RE.test(input.hash) || !BLOCK_HASH_RE.test(input.body)) return null

  const blockIndex = Number(input.block)
  if (!Number.isSafeInteger(blockIndex)) return null
  return {
    blockIndex,
    blockHash: input.hash.toLowerCase(),
    bodyHash: input.body.toLowerCase(),
  }
}

/**
 * 저장 당시 본문+인덱스+블록 해시가 모두 맞을 때만 원문으로 판정한다. 본문이 바뀐 뒤 같은
 * 텍스트가 다른 위치에 남아 있어도 원래 근거라는 보장이 없으므로 추측 재매칭하지 않는다.
 */
export function resolveMinuteSourceBlock(
  blocks: MinuteBlock[], currentBodyHash: string, source: MinuteSourceAnchor,
): number | null {
  if (currentBodyHash !== source.bodyHash) return null
  const indexed = blocks[source.blockIndex]
  if (indexed && isMarkableBlock(indexed) && indexed.hash === source.blockHash) {
    return source.blockIndex
  }
  return null
}
