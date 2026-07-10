'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import type { CellAddr } from '@/lib/domain/sheetSelection'
import type { WeeklyCellKey } from '@/lib/domain/weeklySheet'
import type { PresencePeer } from '@/lib/domain/sheetPresence'

/** 선택 이동이 잦아 재track을 짧게 묶는다 — 방향키 연타가 이벤트 폭주가 되지 않게. */
const TRACK_DEBOUNCE_MS = 150

/** presence track 페이로드(connKey는 presence 키로 전달되므로 페이로드엔 없음). */
interface TrackPayload {
  userId: string
  name: string
  rowId: string
  col: WeeklyCellKey | ''
  editing: boolean
}

/** 주간 시트 프레즌스 — reportId별 Realtime presence 채널에 자기 위치(활성 셀)를 track하고,
 *  같은 문서를 보는 모든 연결의 상태를 돌려준다(자기 제외는 소비자가 도메인 fn으로).
 *  행 동기화 채널(weekly-rows-*)과 분리 — 검증된 데이터 동기화 경로에 리스크를 얹지 않는다. */
export function usePresence({ reportId, me, active, editing, enabled }: {
  reportId: string | null
  me: { id: string; name: string } | null
  active: CellAddr | null
  editing: boolean
  enabled: boolean
}): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([])

  // 연결(탭) 단위 키 — 컴포넌트 수명 동안 고정. 같은 사용자의 다중 탭을 구분한다.
  const connKeyRef = useRef<string | null>(null)
  if (connKeyRef.current === null) {
    connKeyRef.current = `${me?.id ?? 'anon'}:${Math.random().toString(36).slice(2, 10)}`
  }

  // track 페이로드 최신값 — 채널 effect가 재구독 없이 항상 현재 위치를 보내게 ref로 전달.
  const payloadRef = useRef<TrackPayload | null>(null)
  payloadRef.current = me
    ? { userId: me.id, name: me.name, rowId: active?.rowId ?? '', col: active?.col ?? '', editing }
    : null

  type Tracker = { track: (p: TrackPayload) => void } | null
  const trackerRef = useRef<Tracker>(null)

  // 채널 수명 — reportId/사용자 단위. 주차 전환 시 leave/join으로 잔상 제거.
  useEffect(() => {
    if (!enabled || !reportId || !me) { setPeers([]); return }
    const sb = createBrowserClient()
    const channel = sb.channel(`weekly-presence-${reportId}`, {
      config: { presence: { key: connKeyRef.current! } },
    })
    let subscribed = false
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<TrackPayload>()
        const flat: PresencePeer[] = []
        for (const [connKey, metas] of Object.entries(state)) {
          for (const m of metas) {
            if (!m.userId) continue // 페이로드 없는 유령 메타 방어
            flat.push({ connKey, userId: m.userId, name: m.name, rowId: m.rowId, col: m.col, editing: !!m.editing })
          }
        }
        setPeers(flat)
      })
      .subscribe(st => {
        if (st !== 'SUBSCRIBED') return
        subscribed = true
        if (payloadRef.current) void channel.track(payloadRef.current)
      })
    trackerRef.current = { track: p => { if (subscribed) void channel.track(p) } }
    return () => {
      trackerRef.current = null
      void sb.removeChannel(channel) // untrack(leave) 포함 — 타 세션에서 즉시 사라짐
      setPeers([])
    }
  }, [reportId, me?.id, me?.name, enabled]) // eslint-disable-line react-hooks/exhaustive-deps -- me는 원시값으로 구독(객체 참조는 렌더마다 새것)

  // 위치/편집 상태 변경 → 디바운스 재track. 채널 재구독 없이 페이로드만 갱신.
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => {
      if (payloadRef.current && trackerRef.current) trackerRef.current.track(payloadRef.current)
    }, TRACK_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [active?.rowId, active?.col, editing, enabled])

  return peers
}
