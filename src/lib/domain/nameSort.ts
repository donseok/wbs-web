/* ── 사람 이름 정렬(순수) — 앱 전역에서 이름 목록은 항상 가나다순으로 보인다. ── */

/**
 * 한국어 사전순 비교자.
 * - `numeric` : '홍길동2' 가 '홍길동10' 보다 앞. 동명이인 뒤에 번호를 붙이는 관행 대응.
 * - 로케일을 'ko-KR' 로 못박는다 — 사용자 브라우저 로케일(en 등)에 따라 순서가 흔들리면
 *   같은 화면을 보는 두 사람의 명단 순서가 달라진다.
 * Intl.Collator 는 생성 비용이 크므로 모듈 스코프에서 1회만 만든다.
 */
const collator = new Intl.Collator('ko-KR', { numeric: true })

/**
 * 이름 두 개를 가나다순으로 비교한다. `Array.prototype.sort` 비교자로 그대로 쓴다.
 * 이름이 비었거나 없는 항목은 **항상 뒤로** 보낸다(빈 문자열이 맨 앞에 몰리면 명단이 깨져 보인다).
 *
 * 주의: 반환값 0 은 '같은 이름'이 아니라 '정렬상 우열이 없음'이다.
 * numeric 비교 때문에 '홍길동01' 과 '홍길동1' 도 0 을 낸다 — 동일성 판정에 쓰지 말 것.
 */
export function compareKoreanName(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a ?? '').trim()
  const y = (b ?? '').trim()
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return collator.compare(x, y)
}

/** 이름을 가진 객체 목록을 가나다순으로 정렬한 **새 배열**로 반환한다(입력 불변). */
export function sortByKoreanName<T>(
  items: readonly T[],
  getName: (item: T) => string | null | undefined,
): T[] {
  return [...items].sort((a, b) => compareKoreanName(getName(a), getName(b)))
}
