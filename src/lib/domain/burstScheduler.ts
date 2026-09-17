// 이벤트 쇄도를 한 번의 실행으로 접는 스케줄러 — 실시간 push 가 유발하는 서버 재조회용.
//
// 세 가지를 동시에 만족해야 한다.
//   1) 디바운스 — 연속 신호를 합쳐 재조회를 한 번으로 줄인다.
//   2) 상한(maxWait) — 신호가 끊이지 않으면 디바운스만으로는 **영영 실행되지 않는다**(굶음).
//      상한이 없으면 에이전트가 계속 밀어대는 동안 화면이 조용히 낡고, 사용자는 실시간인 줄 안다.
//   3) 지터 — 구독자 전원이 **같은 broadcast 를 같은 순간에** 받으므로 타이머도 같은 순간에
//      만료한다. 디바운스는 한 클라이언트 안에서 신호를 합칠 뿐 여러 클라이언트를 흩지 못한다.
//      실행 시각에 무작위 지연을 더해 버스트를 시간축에 퍼뜨린다(2026-09-17 실측 근거).
//
// 지터는 **버스트마다 한 번만** 뽑는다. 신호마다 다시 뽑으면 같은 버스트 안에서 예정 시각이
// 흔들려 상한 계산이 뜻을 잃는다.

export type BurstScheduler = {
  /** 신호 1건. 실행을 예약하거나 뒤로 미룬다(상한까지만). */
  signal(): void
  /** 예약된 실행을 취소한다. 훅 정리에서 반드시 부른다. */
  cancel(): void
}

export type BurstSchedulerOptions = {
  /** 마지막 신호로부터 이만큼 조용하면 실행한다. */
  delayMs: number
  /** 첫 신호로부터 이 시간을 넘겨 미루지 않는다. delayMs 와 같으면 후행 throttle 이 된다. */
  maxWaitMs: number
  /** 실행 시각에 더할 무작위 지연의 상한(기본 0 = 지터 없음). */
  jitterMs?: number
  /** 테스트 주입용. 기본은 Math.random. */
  random?: () => number
}

export function createBurstScheduler(run: () => void, opts: BurstSchedulerOptions): BurstScheduler {
  const jitterMs = Math.max(0, opts.jitterMs ?? 0)
  const random = opts.random ?? Math.random

  let timer: ReturnType<typeof setTimeout> | null = null
  let deadline = 0 // 이 버스트가 늦어도 실행돼야 하는 절대 시각
  let jitter = 0

  const arm = (ms: number) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; run() }, Math.max(0, ms))
  }

  return {
    signal() {
      const now = Date.now()
      if (timer === null) {
        // 새 버스트가 시작됐다 — 지터를 한 번 뽑고 상한을 고정한다.
        jitter = Math.min(jitterMs, Math.max(0, Math.floor(random() * (jitterMs + 1))))
        deadline = now + opts.maxWaitMs + jitter
      }
      arm(Math.min(now + opts.delayMs + jitter, deadline) - now)
    },
    cancel() {
      if (timer !== null) { clearTimeout(timer); timer = null }
    },
  }
}
