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
  ts: number               // 마지막 track 시각(ms) — 사용자당 최신 위치 판별용
}

export const CELL_PEERS_MAX = 3 // 한 셀에 겹칠 때 이름 칩 표시 상한(초과분은 +N)

/** 셀 키(`rowId:col`) → 그 셀에 있는 타인 목록.
 *  자기 자신(다른 탭 포함)은 제외(구글시트 동일).
 *  **사용자당 최신(ts 최대) 위치 1개만** — 같은 사람이 여러 탭/창으로 접속했거나 track이 겹치면
 *  각 연결의 마지막 셀이 전부 링으로 남아 '클릭 이력'처럼 보인다. 최종 위치만 표시한다. */
export function buildPresenceMap(peers: PresencePeer[], selfUserId: string): Map<string, PresencePeer[]> {
  const latest = new Map<string, PresencePeer>()
  for (const p of peers) {
    if (p.userId === selfUserId) continue
    if (!p.rowId || !p.col) continue
    const prev = latest.get(p.userId)
    if (!prev || (p.ts ?? 0) > (prev.ts ?? 0)) latest.set(p.userId, p)
  }
  const map = new Map<string, PresencePeer[]>()
  for (const p of latest.values()) {
    const k = `${p.rowId}:${p.col}`
    const list = map.get(k)
    if (list) list.push(p)
    else map.set(k, [p])
  }
  return map
}

/** 아바타 원 안에 넣을 짧은 라벨 — 2자까지(한글 이름 '이돈석'→'이돈', 라틴 'John'→'Jo'). */
export function avatarLabel(name: string): string {
  const t = name.trim()
  return t.length <= 2 ? t : t.slice(0, 2)
}

/** 온라인 사용자 목록(툴바 스트립용) — **본인 포함 전원**, userId 단위 dedupe, 이름 가나다순.
 *  (셀 링은 buildPresenceMap이 본인을 제외하지만, 접속자 아바타는 전원을 보여준다 — 사용자 결정.) */
export function onlinePeers(peers: PresencePeer[]): { userId: string; name: string }[] {
  const byId = new Map<string, string>()
  for (const p of peers) if (!byId.has(p.userId)) byId.set(p.userId, p.name)
  return [...byId].map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
