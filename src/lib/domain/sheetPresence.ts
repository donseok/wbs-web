/* ── 시트 프레즌스 도메인(순수) — 사용자 색상 배정·셀 매핑·온라인 목록. I/O 없음. ── */

import type { WeeklyCellKey } from './weeklySheet'

/** 타 사용자 프레즌스 팔레트 — 흰 문서 배경에서 판독 가능한 진한 색.
 *  자기 선택 링(#1a73e8)·저장 상태색(#188038/#d93025)과 겹치지 않게 구성. */
export const PRESENCE_COLORS = [
  '#e8710a', '#34a853', '#a142f4', '#f538a0', '#24c1e0', '#ea4335', '#f9ab00', '#7b5e57',
] as const

/** userId → 결정적 색상. 같은 사용자는 어느 세션·어느 셀에서든 항상 같은 색. */
export function presenceColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]
}

/** Realtime presence track/state로 오가는 최소 페이로드 + 연결 키. */
export interface PresencePeer {
  connKey: string  // 연결(탭) 단위 presence 키 — 같은 사용자의 다중 탭 구분
  userId: string
  name: string
  rowId: string            // 활성 셀 좌표(없으면 '')
  col: WeeklyCellKey | ''
  editing: boolean
}

export const CELL_PEERS_MAX = 3 // 한 셀에 겹칠 때 이름 칩 표시 상한(초과분은 +N)

/** 셀 키(`rowId:col`) → 그 셀에 있는 타인 목록.
 *  자기 자신(다른 탭 포함)은 제외(구글시트 동일), 같은 사용자의 다중 탭이 같은 셀이면 1개만. */
export function buildPresenceMap(peers: PresencePeer[], selfUserId: string): Map<string, PresencePeer[]> {
  const seen = new Set<string>()
  const map = new Map<string, PresencePeer[]>()
  for (const p of peers) {
    if (p.userId === selfUserId) continue
    if (!p.rowId || !p.col) continue
    const dedupe = `${p.userId}@${p.rowId}:${p.col}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const k = `${p.rowId}:${p.col}`
    const list = map.get(k)
    if (list) list.push(p)
    else map.set(k, [p])
  }
  return map
}

/** 온라인 사용자 목록(툴바 스트립용) — 자기 제외, userId 단위 dedupe, 이름 가나다순. */
export function onlinePeers(peers: PresencePeer[], selfUserId: string): { userId: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const p of peers) if (p.userId !== selfUserId && !byId.has(p.userId)) byId.set(p.userId, p.name)
  return [...byId].map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
