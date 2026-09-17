'use client'
// 실시간 신호 → 버스트를 접어 한 번의 무거운 작업으로. 구독(useWbsRealtime)과
// 쇄도 제어(createBurstScheduler)를 잇는 자리다.
//
// 화면이 행 단위로 패치할 수 없을 때(집계값이거나, 페이로드에 없는 데이터로 조립되는 목록)
// 서버에 다시 묻는 수밖에 없다. 그 왕복이 비싸므로 여기서 접고·상한을 두고·흩는다.
import { useEffect, useRef } from 'react'
import { createBurstScheduler, type BurstScheduler } from '@/lib/domain/burstScheduler'
import type { WbsChangePayload } from '@/lib/domain/wbsRealtime'
import { useWbsRealtime } from './useWbsRealtime'

export type UseWbsRealtimeBurstArgs = {
  projectId: string
  /** 버스트가 접힌 뒤 한 번 실행할 일. 매 렌더 새 함수여도 된다(ref 로 고정한다). */
  run: () => void
  delayMs: number
  maxWaitMs: number
  jitterMs: number
  /**
   * 페이로드 1건을 **즉시** 받는다(디바운스 밖). 같은 화면에 행 정체성이 있는 부분(예: 열려 있는
   * 상세 패널)과 재조회가 필요한 부분이 함께 있을 때, 구독 채널을 하나만 열려고 둔 통로다.
   */
  onChange?: (payload: WbsChangePayload) => void
}

export function useWbsRealtimeBurst({
  projectId, run, delayMs, maxWaitMs, jitterMs, onChange,
}: UseWbsRealtimeBurstArgs): void {
  const runRef = useRef(run)
  const onChangeRef = useRef(onChange)
  useEffect(() => { runRef.current = run; onChangeRef.current = onChange })

  const scheduler = useRef<BurstScheduler | null>(null)
  useEffect(() => {
    const s = createBurstScheduler(() => runRef.current(), { delayMs, maxWaitMs, jitterMs })
    scheduler.current = s
    return () => { s.cancel(); scheduler.current = null } // 언마운트 뒤 실행이 남지 않게
  }, [delayMs, maxWaitMs, jitterMs])

  useWbsRealtime({
    projectId,
    onChange: payload => { onChangeRef.current?.(payload); scheduler.current?.signal() },
    // 끊긴 사이의 변경은 페이로드가 오지 않았다 — 재연결 시점에 한 번 물어서 메운다.
    onReconnect: () => scheduler.current?.signal(),
  })
}
