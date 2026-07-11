// 쓰기 명령 게이트 — 보수적: 확실한 쓰기 동사+대상이 있을 때만 true.
// 조회 질문(알려줘/보여줘/뭐야/찾아줘/목록)은 반드시 false — 오탐은 조회 경험을 깨뜨린다.
// 쓰기 동사는 명령형 어미(줘/주세요)까지 요구 — 어간만으로는 발화가 명령이라 단정할 수 없다.

const WRITE_CUE =
  /((올려|바꿔|미뤜|당겨)\s*(줘|주세요)|(변경|수정)해\s*(줘|주세요)|변경(해\s*줘?)?$|완료\s*처리|완료로\s*(해\s*)?(줘|주세요))/
const READ_CUE = /(알려\s*줘|보여\s*줘|뭐야|뭐지|찾아\s*줘|목록|현황|정리해\s*줘|요약)/

/** 사용자 발화가 쓰기 명령인지 판별하는 보수적 게이트 함수 */
export function isCommandUtterance(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  if (READ_CUE.test(t)) return false
  return WRITE_CUE.test(t)
}
