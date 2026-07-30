/**
 * 위키 재구축 러너의 정지 정책 — 순수 함수. I/O 없음.
 *
 * 원래 러너는 `attempted === 0` 이면 즉시 break 했다. 그런데 finish_wiki_project_rebuild_step
 * 은 스텝이 전진하지 못했을 때 run_after 를 +15초로 미룬다(minute job 이 아직 pending/running
 * 이거나 apply RPC 가 게이트웨이 타임아웃을 맞은 경우). 즉 **정상 백오프 한 번이 곧 종료**였고,
 * 2026-07-30 재구축 복구에서 러너가 42건 중 6건만 처리하고 끝난 원인이 이것이다.
 *
 * 그래서 "빈손 라운드"와 "할 일 없음"을 구분한다 — 빈손이면 백오프보다 길게 기다렸다가
 * 다시 두드리고, 연속 IDLE_LIMIT 회 빈손일 때만 남은 작업이 없다고 판정한다.
 */

/** 연속 빈손 허용 횟수. 이 횟수를 넘기면 큐가 비었다고 본다. */
export const IDLE_LIMIT = 3

/** 무한 루프 방지 backstop. 한 라운드가 스텝 2~3건이므로 42건 회의록에 넉넉하다. */
export const ROUND_CAP = 40

/** finish 가 미루는 15초보다 길게 기다려야 다음 claim 이 due 를 만난다. */
export const IDLE_WAIT_MS = 20_000

/**
 * @param {{round: number, idle: number}} state 직전 상태
 * @param {{attempted: number}} result 방금 끝난 runWikiWorkerOnce 결과
 * @returns {{round: number, idle: number, stop: boolean, reason: string|null, waitMs: number}}
 */
export function nextRebuildLoopState(state, result) {
  const round = state.round + 1
  const idle = result.attempted === 0 ? state.idle + 1 : 0

  if (idle >= IDLE_LIMIT) {
    return { round, idle, stop: true, reason: 'drained', waitMs: 0 }
  }
  if (round >= ROUND_CAP) {
    return { round, idle, stop: true, reason: 'round-cap', waitMs: 0 }
  }
  return {
    round,
    idle,
    stop: false,
    reason: null,
    waitMs: idle > 0 ? IDLE_WAIT_MS : 0,
  }
}
