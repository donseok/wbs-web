// src/components/agents/SeatmapRealtime.tsx
'use client'
// 좌석표 실시간 — 층(프로젝트)마다 0098 채널을 듣고, 신호가 오면 좌석표를 한 번 재조회한다.
//
// 왜 필요한가(2026-09-18 실측): done 보고마다 서버는 wbs_changed 를 초 단위로 정확히 쐈고
// 허브·WBS 는 1~5초 안에 따라왔는데, 스튜디오만 채널을 듣지 않아 30초 폴링을 기다렸다.
// 사용자는 "작업이 끝나도 바로 안 바뀌고 다시 조회해야 바뀐다" 로 겪었다.
//
// 부분 패치가 아니라 재조회인 이유는 허브와 같다 — 좌석 상태는 주문 status·보고 판정·heartbeat 로
// 조립되는데 트리거 페이로드에는 {항목 id, 단계, 실적} 뿐이다. 30초 폴링은 안전망으로 남긴다:
// heartbeat·재개 요청처럼 wbs_items 를 건드리지 않는 변화는 이 채널로 오지 않는다.
//
// 전체 스튜디오는 층이 여럿이라 채널도 여럿이다. 훅을 반복문에서 부를 수 없으니 층마다 빈 컴포넌트를
// 하나씩 두고, 스케줄러는 하나로 모아 여러 층의 신호가 겹쳐도 재조회는 한 번만 간다.
import { useEffect, useRef } from 'react'
import { createBurstScheduler, type BurstScheduler } from '@/lib/domain/burstScheduler'
import { useWbsRealtime } from '@/lib/hooks/useWbsRealtime'

function FloorChannel({ projectId, onSignal }: { projectId: string; onSignal: () => void }) {
  // 끊겼다 붙은 사이의 변경은 페이로드가 오지 않았다 — 재연결도 신호로 친다.
  useWbsRealtime({ projectId, onChange: () => onSignal(), onReconnect: () => onSignal() })
  return null
}

export function SeatmapRealtime({ projectIds, run }: { projectIds: readonly string[]; run: () => void }) {
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })

  const scheduler = useRef<BurstScheduler | null>(null)
  useEffect(() => {
    // 허브와 같은 값 — 조작 화면이라 체감이 중요하고, 보는 사람이 소수라 쇄도 위험이 작다.
    const s = createBurstScheduler(() => runRef.current(), { delayMs: 1_000, maxWaitMs: 5_000, jitterMs: 2_000 })
    scheduler.current = s
    return () => { s.cancel(); scheduler.current = null }
  }, [])

  const signal = useRef(() => scheduler.current?.signal()).current
  return <>{projectIds.map(id => <FloorChannel key={id} projectId={id} onSignal={signal} />)}</>
}
