/* ── 시트 키 조합 판정(순수) — 플랫폼별 근육 기억을 한곳에서 흡수한다. ── */

/** 셀 안에서 한 줄 내려 계속 쓰는 조합.
 *  Windows는 Alt+Enter(엑셀)·Ctrl+Enter(구글시트), macOS는 ⌥+Enter·⌘+Enter를 쓴다.
 *  셋 다 받아 어느 쪽 습관이든 통하게 한다. 맨 Enter는 저장 후 아래 칸, Shift+Enter는 위 칸(엑셀 관례). */
export function isNewlineChord(
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return e.key === 'Enter' && (e.altKey || e.ctrlKey || e.metaKey)
}
