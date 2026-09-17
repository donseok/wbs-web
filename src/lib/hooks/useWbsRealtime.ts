// src/lib/hooks/useWbsRealtime.ts — WBS 프로젝트 private 채널 구독. 송신은 0098 트리거.
// 순수 계층(토픽·페이로드 해석)은 @/lib/domain/wbsRealtime 에 있다.
'use client'

import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { parseWbsPayload, wbsChannelTopic, type WbsChangePayload } from '@/lib/domain/wbsRealtime'

export type UseWbsRealtimeArgs = {
  projectId: string
  /** 페이로드 1건. 호출부가 부분 패치를 한다. */
  onChange: (payload: WbsChangePayload) => void
  /** 끊겼다 다시 붙었을 때의 누락분 보정. 최초 구독에서는 부르지 않는다. */
  onReconnect?: () => void
}

export function useWbsRealtime({ projectId, onChange, onReconnect }: UseWbsRealtimeArgs): void {
  // 콜백을 ref 로 고정한다. deps 에 넣으면 호출부가 useCallback 을 빠뜨렸을 때
  // 구독 → refresh → 새 콜백 → effect 재실행 의 무한 재구독 루프에 빠진다
  // (WeeklySheetView 주석이 기록한 실제 사고). deps 는 원시값 projectId 하나뿐이다.
  const onChangeRef = useRef(onChange)
  const onReconnectRef = useRef(onReconnect)
  useEffect(() => {
    onChangeRef.current = onChange
    onReconnectRef.current = onReconnect
  })

  useEffect(() => {
    if (!projectId) return
    type Sb = ReturnType<typeof createBrowserClient>
    let sb: Sb | null = null
    let channel: ReturnType<Sb['channel']> | null = null
    let alive = true
    let subscribedOnce = false

    // 구독 설정 전체를 감싼다 — 향상 계층이라 어떤 단계에서 던져도 기존 갱신 경로
    // (경로 전환 재조회·revalidatePath)를 막아서는 안 된다. 클라이언트 **생성**도 안에 둔다:
    // @supabase/ssr 은 URL·키가 비면 그 자리에서 던지고, 그게 effect 밖이면 화면이 통째로 죽는다.
    ;(async () => {
      try {
        sb = createBrowserClient()
        // getUser() 는 GoTrue 네트워크 왕복이다. 여기서 필요한 건 "세션이 있는가" 뿐이고
        // private 채널 인가는 서버(setAuth 토큰)가 검증하므로 로컬 세션 읽기로 충분하다
        // (useInboxRealtime 과 같은 판단, 2026-08-18 성능 감사).
        const { data } = await sb.auth.getSession()
        if (!alive || !data.session) return
        sb.realtime.setAuth() // private 채널 인가 토큰 갱신
        channel = sb
          .channel(wbsChannelTopic(projectId), { config: { private: true } })
          .on('broadcast', { event: 'wbs_changed' }, msg => {
            const payload = parseWbsPayload((msg as { payload?: unknown }).payload)
            if (payload) onChangeRef.current(payload)
          })
          .subscribe(status => {
            if (status !== 'SUBSCRIBED') return
            // 최초 구독은 SSR 결과가 이미 최신이라 보정이 필요 없다. 두 번째 이후
            // (끊김 → 재연결)에만 그 사이의 누락분을 메운다(설계 §6-2).
            if (!subscribedOnce) { subscribedOnce = true; return }
            onReconnectRef.current?.()
          })
      } catch {
        // 삼킨다 — 실시간이 죽어도 화면은 종전 경로로 계속 갱신된다.
      }
    })()

    return () => {
      alive = false
      if (sb && channel) sb.removeChannel(channel) // leak 1순위 함정 — 반드시 정리
    }
  }, [projectId])
}
