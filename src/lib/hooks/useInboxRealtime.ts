// src/lib/hooks/useInboxRealtime.ts — 알림 private 채널 구독. 벨 마운트 1회, 정리 필수(채널 leak 방지).
'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

export function useInboxRealtime(onNew: () => void) {
  useEffect(() => {
    const sb = createBrowserClient()
    let channel: ReturnType<typeof sb.channel> | null = null
    let alive = true
    // 구독 설정 전체를 감싼다 — 향상 계층이므로 어떤 단계에서 던져도(클라이언트 형태 불일치 포함)
    // 폴링 경로(Task 6)를 막지 않는다.
    ;(async () => {
      try {
        // getUser() 는 GoTrue /auth/v1/user 네트워크 왕복(실측 0.9~1.8s)이다. 여기서 필요한 건
        // 채널명에 넣을 user id 뿐이고, private 채널 인가는 어차피 서버(setAuth 토큰)가 검증하므로
        // 로컬 세션 읽기(getSession, 무왕복)로 충분하다(2026-08-18 성능 감사).
        const { data } = await sb.auth.getSession()
        const user = data.session?.user
        if (!alive || !user) return
        sb.realtime.setAuth() // private 채널 인가 토큰 갱신
        channel = sb
          .channel(`user-${user.id}-notifications`, { config: { private: true } })
          .on('broadcast', { event: 'new_notification' }, () => onNew())
          .subscribe()
      } catch {
        // 구독 실패는 삼킨다 — 벨 배지는 기존 폴링(경로 전환 재조회)로 계속 갱신된다.
      }
    })()
    return () => {
      alive = false
      if (channel) sb.removeChannel(channel) // leak 1순위 함정 — 반드시 정리
    }
    // onNew 는 ref 로 고정하지 않는다 — 호출부가 useCallback 으로 안정화해서 넘긴다.
  }, [onNew])
}
