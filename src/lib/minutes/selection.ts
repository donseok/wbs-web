import { fnv1a64, isMarkableBlock, type MinuteBlock } from './blocks'

/** 버블 표출 최소 선택 길이(공백 제거 기준) — 클라 게이트 전용, 서버는 비어있지 않음만 요구. */
export const MINUTE_SELECTION_MIN_CHARS = 5
/** 선택 범위 블록 수 상한 — 클라 버블 게이트와 서버 유효성 검사가 같은 값을 쓴다. */
export const MINUTE_SELECTION_MAX_BLOCK_SPAN = 200
/** 선택 원본 텍스트 길이 상한(이슈 본문 TEXT_MAX 와 동일) — 클라·서버 공유. */
export const MINUTE_SELECTION_MAX_CHARS = 20_000

/** DOM 선택 원본을 발췌 저장·미리보기 공통 형태로 정규화. 클라 미리보기 = 서버 저장 계약. */
export function normalizeSelectionText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** 원문 대조용 — DOM 렌더 텍스트와 mdast 평문의 차이(표 구분자·개행·NBSP)는 전부 공백이다. */
export function stripSelectionWhitespace(value: string): string {
  return value.replace(/\s+/g, '')
}

/** 같은 블록의 서로 다른 선택을 source_key 조회에서 구분하는 해시. */
export function minuteSelectionKeyHash(excerpt: string): string {
  return fnv1a64(stripSelectionWhitespace(excerpt))
}

export type MinuteSelectionMatch =
  | { ok: true; excerpt: string }
  | { ok: false; reason: 'anchor' | 'empty' | 'text' }

/**
 * 클라이언트 선택 텍스트를 불변 버전 블록 원문과 대조한다. 공백 제거 연속 부분 문자열이면서
 * 실제로 시작·끝 블록 양쪽에 걸친 선택만 인정한다. 본문이 바뀐 뒤의 추측 재매칭은 하지
 * 않는다(source.ts 원칙) — 실패는 실패로 돌려준다.
 */
export function matchMinuteSelection(
  blocks: readonly MinuteBlock[],
  startIndex: number,
  startHash: string,
  endIndex: number,
  endHash: string,
  rawText: string,
): MinuteSelectionMatch {
  const start = blocks[startIndex]
  const end = blocks[endIndex]
  if (
    !Number.isSafeInteger(startIndex) || !Number.isSafeInteger(endIndex)
    || startIndex < 0 || endIndex < startIndex
    || !start || !end || !isMarkableBlock(start) || !isMarkableBlock(end)
    || start.hash !== startHash.toLowerCase() || end.hash !== endHash.toLowerCase()
  ) return { ok: false, reason: 'anchor' }

  const normalized = normalizeSelectionText(rawText)
  if (!normalized) return { ok: false, reason: 'empty' }
  const needle = stripSelectionWhitespace(normalized)

  // 블록별 스트립 텍스트와 원문 좌표 맵 — 발췌를 클라 문자열이 아니라 서버 원문에서 재구성한다.
  const spans: Array<{ from: number; text: string; posMap: number[] }> = []
  let haystack = ''
  let startSpanEnd = 0
  let endSpanFrom = 0
  for (let index = startIndex; index <= endIndex; index += 1) {
    const candidate = blocks[index]
    if (!candidate || !isMarkableBlock(candidate)) continue
    const original = candidate.text
    const posMap: number[] = []
    let stripped = ''
    for (let i = 0; i < original.length; i += 1) {
      if (/\s/.test(original[i])) continue
      posMap.push(i)
      stripped += original[i]
    }
    if (index === endIndex) endSpanFrom = haystack.length
    spans.push({ from: haystack.length, text: original, posMap })
    haystack += stripped
    if (index === startIndex) startSpanEnd = haystack.length
  }

  // 유효 매치는 시작 블록 안에서 시작하고(at < startSpanEnd) 끝 블록에 최소 1자 걸쳐야
  // 한다(at + len > endSpanFrom). 조건을 만족할 수 있는 최소 시작 위치(lo)부터 한 번만
  // 찾는다 — 반복 문구 전수 순회(O(H×N) 이벤트 루프 점유)를 피하는 등가 판정이다.
  const lo = Math.max(0, endSpanFrom - needle.length + 1)
  if (lo >= startSpanEnd) return { ok: false, reason: 'text' }
  const at = haystack.indexOf(needle, lo)
  if (at < 0 || at >= startSpanEnd) return { ok: false, reason: 'text' }

  // 발췌는 매치 좌표로 잘라낸 서버 원문이다 — 클라이언트가 공백·줄바꿈 재배치로 뉘앙스를
  // 위조해 provenance 스냅샷에 심을 수 없다. 블록 경계만 줄바꿈으로 구분한다.
  const parts: string[] = []
  for (const span of spans) {
    const from = Math.max(at, span.from)
    const to = Math.min(at + needle.length, span.from + span.posMap.length)
    if (from >= to) continue
    parts.push(span.text.slice(span.posMap[from - span.from], span.posMap[to - span.from - 1] + 1))
  }
  return { ok: true, excerpt: parts.join('\n') }
}
