'use client'
// 집계 화면용 실시간 갱신 — 화면을 직접 고치지 않고 서버에 다시 묻는다.
//
// 대시보드의 진척률은 롤업 집계라 `{항목 id, 단계, 실적%}` 페이로드만으로는 새 값을 유도할 수
// 없다. 그래서 여기만 재조회(router.refresh = Server Component 전량 재렌더)를 쓴다. 그 왕복이
// 비싸므로 버스트를 접고(디바운스) 상한을 두고(maxWait) 흩는다(지터).
//
// 지터가 필요한 이유는 측정으로 드러났다(2026-09-17): 구독자 전원이 **같은 broadcast 를 같은
// 순간에** 받으므로 타이머도 같은 순간에 만료한다. 디바운스는 한 클라이언트 안에서 신호를 합칠
// 뿐 여러 클라이언트를 시간축에 흩지 못한다. 실측으로 대시보드 1회 렌더가 PostgREST 요청 약
// 20건이라, 동시 재조회가 한 점에 몰리면 서버 CPU 가 버스트를 맞는다.
//
// 이 컴포넌트는 아무것도 그리지 않는다 — 서버 컴포넌트 페이지가 구독을 담을 자리로 쓴다.
import { useRouter } from 'next/navigation'
import { useWbsRealtimeBurst } from '@/lib/hooks/useWbsRealtimeBurst'

export type WbsRealtimeRefreshProps = {
  projectId: string
  /** 마지막 신호로부터의 정적 시간. 기본 10초. */
  delayMs?: number
  /** 첫 신호로부터의 상한. 기본 10초 — delayMs 와 같으면 후행 throttle 이 된다. */
  maxWaitMs?: number
  /** 구독자들을 흩는 무작위 지연의 상한. 기본 10초. */
  jitterMs?: number
}

export function WbsRealtimeRefresh({
  projectId,
  delayMs = 10_000,
  maxWaitMs = 10_000,
  jitterMs = 10_000,
}: WbsRealtimeRefreshProps) {
  const router = useRouter()
  useWbsRealtimeBurst({ projectId, run: () => router.refresh(), delayMs, maxWaitMs, jitterMs })
  return null
}
