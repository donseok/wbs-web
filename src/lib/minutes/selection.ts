import { fnv1a64, isMarkableBlock, type MinuteBlock } from './blocks'

/** 버블 표출 최소 선택 길이(공백 제거 기준) — 클라 게이트 전용, 서버는 비어있지 않음만 요구. */
export const MINUTE_SELECTION_MIN_CHARS = 5
/** 비정상 요청 방어용 선택 범위 블록 수 상한. */
export const MINUTE_SELECTION_MAX_BLOCK_SPAN = 200

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

  const excerpt = normalizeSelectionText(rawText)
  if (!excerpt) return { ok: false, reason: 'empty' }
  const needle = stripSelectionWhitespace(excerpt)

  let haystack = ''
  let startSpanEnd = 0
  let endSpanFrom = 0
  for (let index = startIndex; index <= endIndex; index += 1) {
    const candidate = blocks[index]
    if (!candidate || !isMarkableBlock(candidate)) continue
    if (index === endIndex) endSpanFrom = haystack.length
    haystack += stripSelectionWhitespace(candidate.text)
    if (index === startIndex) startSpanEnd = haystack.length
  }

  // 같은 문구가 반복되면 첫 매치가 다른 위치일 수 있다 — 양 끝 블록에 걸치는 매치를 찾을 때까지 순회.
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (at < startSpanEnd && at + needle.length > endSpanFrom) return { ok: true, excerpt }
  }
  return { ok: false, reason: 'text' }
}
