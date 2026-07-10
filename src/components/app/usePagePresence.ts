'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

/** track 페이로드 — 신원만. 셀 좌표가 필요한 주간 시트는 weekly/usePresence를 쓴다. */
interface TrackPayload {
  userId: string
  name: string
}

export interface OnlineUser {
  userId: string
  name: string
}

/** 페이지(메뉴) 단위 프레즌스 — 같은 화면에 머무는 사용자 목록(본인 포함).
 *  주간 시트 usePresence의 축약형: 위치 추적 없이 "누가 이 메뉴를 보고 있나"만 track한다.
 *  channelKey는 화면 단위로 유일하게(예: `wbs-${projectId}`). userId 단위 dedupe, 이름 가나다순. */
export function usePagePresence({ channelKey, me, enabled }: {
  channelKey: string
  me: { id: string; name: string } | null
  enabled: boolean
}): OnlineUser[] {
  const [online, setOnline] = useState<OnlineUser[]>([])

  // 연결(탭) 단위 키 — 컴포넌트 수명 동안 고정. 같은 사용자의 다중 탭을 구분한다.
  const connKeyRef = useRef<string | null>(null)
  if (connKeyRef.current === null) {
    connKeyRef.current = `${me?.id ?? 'anon'}:${Math.random().toString(36).slice(2, 10)}`
  }

  useEffect(() => {
    if (!enabled || !me) { setOnline([]); return }
    const sb = createBrowserClient()
    const channel = sb.channel(`page-presence-${channelKey}`, {
      config: { presence: { key: connKeyRef.current! } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<TrackPayload>()
        const byId = new Map<string, string>()
        for (const metas of Object.values(state)) {
          for (const m of metas) {
            if (m.userId && !byId.has(m.userId)) byId.set(m.userId, m.name)
          }
        }
        setOnline(
          [...byId]
            .map(([userId, name]) => ({ userId, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
        )
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') void channel.track({ userId: me.id, name: me.name } satisfies TrackPayload)
      })
    return () => {
      void sb.removeChannel(channel) // untrack(leave) 포함 — 타 세션에서 즉시 사라짐
      setOnline([])
    }
  }, [channelKey, me?.id, me?.name, enabled]) // eslint-disable-line react-hooks/exhaustive-deps -- me는 원시값으로 구독(객체 참조는 렌더마다 새것)

  return online
}
