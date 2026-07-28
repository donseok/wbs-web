/**
 * 회의록 폴더 기능 전환 스위치 (서버 전용).
 *
 * ⚠️ `NEXT_PUBLIC_` 접두가 없으므로 **클라이언트 번들에서는 항상 `undefined`** 다.
 * 클라이언트 컴포넌트에서 직접 부르면 서버가 켜져 있어도 `false` 로 읽혀 조용히 어긋난다.
 * 반드시 서버 컴포넌트에서 평가해 **prop 으로 내려보내고**, 실제 방어는 서버 액션에서 한다.
 *
 * 등록 편철 스위치(`MINUTES_FOLDER_PATH_ENABLED`)는 외부 API 전용이라
 * `@/lib/minutes/externalApi` 의 `folderPathEnabled()` 에 있다.
 */

/**
 * R4(결정 §2-A C-2) — 폴더 중심 UI 재편의 **드래그앤드롭**을 여는 스위치.
 *
 * 왜 꺼서 내보내는가: 재편철 1회차 전에 사용자가 회의록·폴더를 옮기면, 그 건이 배치에서
 * `skipped(manual_placement)` 로 빠지면서 **부분 일치가 '완료'로 보고**된다(결정 §2-A C-2 가
 * 지목한 그 창). 재편철 1회차 APPLY 가 끝나면 env 만 켜면 되고 코드 배포는 필요 없다.
 *
 * 범위는 **D&D 한정**이다. 폴더 트리 선택(업로드·수정 모달)과 [이동] 버튼의 폴더 픽커는
 * 그대로 열려 있다 — 의도적인 단일 조작이라 드래그처럼 무심코 일어나지 않고, 결정이 막으려던
 * 것은 "정리 차원의 대량 이동"이다.
 */
export function folderDndEnabled(): boolean {
  return process.env.MINUTES_FOLDER_DND_ENABLED === 'true'
}
