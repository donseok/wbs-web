// src/lib/domain/heavyWork.ts — 무거운 작업 표시, IO 없음.
// 설계: docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md
// 팀장 lease 갱신(60초)이 heavy.sh 슬롯을 읽어 renew 에 싣고(dflow-lease.sh), 서버가 주문·lease 행에 적는다(0106).
// 여기서는 그 본문을 검사하고, 화면이 믿을 값만 골라 사람 말로 바꾼다.

export const HEAVY_MAX_ORDERS = 50
/** 저장·표시하는 명령 길이(코드포인트). 셸(dflow-lease.sh)도 190 으로 자른다. */
export const HEAVY_CMD_KEEP = 190
/** 받는 명령 원문의 상한(UTF-16 길이) — 이보다 길면 그 항목만 버린다. */
export const HEAVY_CMD_MAX = 2000

export interface HeavyPc { k: number | null; held: number | null; waiting: number | null; load: number | null; cpus: number | null }
export interface HeavyOrder {
  id8: string; state: 'run' | 'wait'; kind: 'run' | 'hold'; pool: 'general' | 'docker'
  since: number | null; pos: number | null; n: number; cmd: string
}
export interface HeavyReport { pc: HeavyPc; orders: HeavyOrder[] }

/** 좌석에 보일 무거운 작업. more = 같은 워크트리의 나머지 건수(병렬 묶음 단위·E2E 서버 hold). */
export interface SeatHeavy {
  state: 'run' | 'wait'; label: string; cmd: string; sinceMs: number | null; pos: number | null; more: number; docker: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const natOrNull = (v: unknown, max = 100_000): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max)
const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000)
const EPOCH_MAX = 99_999_999_999

function parseOrder(o: unknown): HeavyOrder | null {
  if (!isObj(o)) return null
  if (typeof o.id8 !== 'string' || !/^[0-9a-f]{8}$/.test(o.id8)) return null
  if (o.state !== 'run' && o.state !== 'wait') return null
  if (o.kind !== 'run' && o.kind !== 'hold') return null
  if (o.pool !== 'general' && o.pool !== 'docker') return null
  if (!natOrNull(o.since, EPOCH_MAX) || !natOrNull(o.pos, 10_000)) return null
  if (typeof o.n !== 'number' || !Number.isInteger(o.n) || o.n < 1 || o.n > 99) return null
  if (typeof o.cmd !== 'string' || o.cmd.length > HEAVY_CMD_MAX) return null
  return { id8: o.id8, state: o.state, kind: o.kind, pool: o.pool, since: o.since, pos: o.pos, n: o.n, cmd: sanitizeHeavyCmd(o.cmd) }
}

const SECRET_FLAG = /^-{1,2}[A-Za-z0-9_-]*(token|secret|key|pass|pwd|auth|header|cookie|cred)[A-Za-z0-9_-]*$|^(-H|-u|bearer|basic)$/i
function heavyTok(t: string): string | null {
  if (t === '<url>') return t
  if (t.includes('://')) return '<url>'
  if (t.includes('=')) {
    const k = t.split('=')[0]
    return /^-{0,2}[A-Za-z_][A-Za-z0-9_.-]*$/.test(k) ? `${k}=***` : '***'
  }
  const base = t.split('/').pop()!.split('\\').pop()!
  if (!base) return null
  return /^[A-Za-z0-9_.:+,-]+$/.test(base) ? base : '***'
}

/**
 * 명령 가림(허용 목록) — 셸(dflow-lease.sh lease_heavy_json 의 clean)과 같은 규칙을 서버가 한 번 더 건다(옛·잘못된 킷 대비).
 * 경로는 마지막 조각만(홈·워크트리 경로가 남지 않는다), `a=b`·`a='…'` 는 `a=***`, URL 은 `<url>`, 비밀 류 플래그(--token·-H·
 * Bearer …) 바로 뒤 토큰은 `***`, 영숫자·`_.:+,-` 밖의 글자가 든 토큰은 `***`. 같은 입력에 두 번 걸어도 결과가 같다.
 */
export function sanitizeHeavyCmd(cmd: string): string {
  const toks = cmd.replace(/=("[^"]*"|'[^']*')/g, '=***').replace(/["'`]/g, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  let hide = false
  for (const t of toks) {
    if (hide) out.push('***')
    else { const v = heavyTok(t); if (v !== null) out.push(v) }
    hide = SECRET_FLAG.test(t)
  }
  return Array.from(out.join(' ')).slice(0, HEAVY_CMD_KEEP).join('')
}

function parsePc(p: unknown): HeavyPc | null {
  if (!isObj(p)) return null
  const { k = null, held = null, waiting = null, load = null, cpus = null } = p
  if (!natOrNull(k, 1000) || !natOrNull(held, 1000) || !natOrNull(waiting, 10_000) || !numOrNull(load) || !natOrNull(cpus, 10_000)) return null
  return { k, held, waiting, load, cpus }
}

/** renew 본문의 heavy. 틀리면 거절 — 라우트는 renew 는 받아들이고 heavy 만 버린다(lease 를 잃지 않게). */
export function parseHeavyReport(raw: unknown): { ok: true; value: HeavyReport } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'heavy 는 객체여야 합니다.' }
  const pc = parsePc(raw.pc)
  if (!pc) return { ok: false, error: 'heavy.pc 형식이 올바르지 않습니다.' }
  if (!Array.isArray(raw.orders) || raw.orders.length > HEAVY_MAX_ORDERS) {
    return { ok: false, error: `heavy.orders 는 ${HEAVY_MAX_ORDERS}개 이하 배열이어야 합니다.` }
  }
  const orders: HeavyOrder[] = []
  // 틀린 항목은 그 항목만 건너뛴다 — 하나 때문에 PC 게이지까지 통째로 버리지 않는다.
  for (const o of raw.orders) {
    const v = parseOrder(o)
    if (v) orders.push(v)
  }
  return { ok: true, value: { pc, orders } }
}

/** 명령 → 작업 이름. 순서가 뜻이다(변이 검증 안의 test·build 가 먼저 걸리지 않게). 원 명령은 툴팁이 보인다. */
const LABELS: ReadonlyArray<[RegExp, string]> = [
  [/mutation|stryker|pitest|mutmut/i, '변이 검증'],
  [/mssqlMigrationTest/i, 'MSSQL 마이그레이션 시험'],
  [/playwright|\be2e\b|smoke/i, 'E2E 스모크'],
  [/\bnpm (ci|install|i)\b|\bpnpm (install|i)\b|\byarn( install)?$|\byarn install\b|--refresh-dependencies/i, '의존성 설치'],
]
const NARROW = /--tests\b|\brelated\b|\s-t\s|--testNamePattern|\.(test|spec)\.[cm]?[jt]sx?\b/
const TEST = /\btestAll\b|\bvitest\b|\bjest\b|\bpytest\b|\bnpm (run )?test\b|\b(gradlew|gradle|mvn)\b.*\btest\b/i

export function heavyLabel(raw: string, kind: 'run' | 'hold'): string {
  if (kind === 'hold') return 'E2E 서버'
  // Gradle 제외 인자(-x mssqlMigrationTest)의 태스크 이름은 돌지 않는 작업이다 — 분류에서 뺀다.
  const cmd = raw.replace(/(^|\s)(-x|--exclude-task)\s+\S+/g, ' ')
  for (const [re, name] of LABELS) if (re.test(cmd)) return name
  if (TEST.test(cmd)) return NARROW.test(cmd) ? '테스트 실행' : '전체 테스트'
  if (/\bgradlew?\b.*\b(build|assemble|compile\w*|check)\b/i.test(cmd)) return 'Gradle 빌드'
  if (/\bmvn\b/i.test(cmd)) return 'Maven 빌드'
  if (/\bnext build\b|\bnpm run build\b|\btsc\b|\bvite build\b/i.test(cmd)) return '빌드'
  if (/\bdocker\b/i.test(cmd)) return '도커 작업'
  return '무거운 명령'
}

/**
 * 주문의 heartbeat_heavy(0106) → 좌석 값. claimed 이고, 적은 팀장(by)의 그 프로젝트 lease 가 살아 있을 때만 믿는다 —
 * 팀장이 죽으면 값이 남지만 lease 가 만료돼 저절로 무효가 된다.
 */
export function seatHeavyOf(
  raw: unknown, order: { status: string; projectId: string; claimedByUserId: string | null },
  liveLeases: ReadonlyArray<{ user_id: string; project_id: string }>,
): SeatHeavy | null {
  if (order.status !== 'claimed' || !isObj(raw)) return null
  const { state, kind, pool, since, pos, n, cmd, by } = raw
  if ((state !== 'run' && state !== 'wait') || typeof by !== 'string') return null
  // 팀원은 팀장과 같은 신원으로 claim 한다(0106 함수와 같은 축) — 남이 점유한 좌석의 값은 믿지 않는다.
  if (order.claimedByUserId !== by) return null
  if (!liveLeases.some(l => l.user_id === by && l.project_id === order.projectId)) return null
  const c = typeof cmd === 'string' ? cmd : ''
  return {
    state, label: heavyLabel(c, kind === 'hold' ? 'hold' : 'run'), cmd: c,
    sinceMs: typeof since === 'number' && Number.isFinite(since) ? since * 1000 : null,
    pos: typeof pos === 'number' && Number.isInteger(pos) ? pos : null,
    more: typeof n === 'number' && Number.isInteger(n) && n > 1 ? n - 1 : 0,
    docker: pool === 'docker',
  }
}

const fmtLoad = (x: number) => { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }

/** 팀장 칩 게이지 — `🔥 보유/K · ⏳ 대기 · load N`. 아무것도 돌지도 기다리지도 않으면 null. */
export function heavyGauge(raw: unknown): { text: string; hot: boolean } | null {
  const pc = parsePc(raw)
  if (!pc || pc.k === null || pc.held === null) return null
  const waiting = pc.waiting ?? 0
  if (pc.held === 0 && waiting === 0) return null
  const parts = [`🔥 ${pc.held}/${pc.k}`]
  if (waiting > 0) parts.push(`⏳ ${waiting}`)
  if (pc.load !== null) parts.push(`load ${fmtLoad(pc.load)}`)
  const hot = pc.held >= pc.k || (pc.load !== null && pc.cpus !== null && pc.cpus > 0 && pc.load > pc.cpus)
  return { text: parts.join(' · '), hot }
}
