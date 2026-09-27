/**
 * 실적 크레딧 표(스펙 2026-09-15 §3.3·§3.4) — 순수 함수. 값의 정본은 DB(project_settings.stage_credits)이고
 * 전이 때 실제 계산은 RPC apply_workflow_event 가 한다. 여기 기본값·규칙은 그 SQL 과 같아야 한다
 * (tests/migrations/0108-design-state.test.ts 가 SQL 상수와 비교한다).
 * ds(설계 중)는 0107, dd(설계 완료)는 0108 에서 들어왔다. ds·dd 는 간격 규칙에서 빠지고 as ≤ ds ≤ dd ≤ ip 만 지킨다(설계 상태 스펙 D18).
 */
export const CREDIT_KEYS = ['as', 'ds', 'dd', 'ip', 'rw', 'im', 'xx'] as const
export type CreditKey = (typeof CREDIT_KEYS)[number]
export type CreditTable = Record<CreditKey, number>
/**
 * 표는 `default` 하나뿐이다(2026-09-16 결정). 카테고리별 `if`·`doc` 표를 없앴다 — 쓰는 프로젝트가 거의 없는데
 * 설정 화면에는 모든 프로젝트에 슬라이더가 세 벌씩 쌓였다. 항목의 `credit_key`(0089) 는 남지만 전이 계산에 쓰지 않는다.
 */
export type StageCredits = { default: CreditTable }

export const DEFAULT_STAGE_CREDITS: StageCredits = {
  default: { as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 },
}
export const CREDIT_STEP = 5
export const CREDIT_GAP = 10
/** 10 간격을 지키는 핵심 사슬. ds·dd 는 여기서 빠진다(D18). */
const CORE_KEYS: readonly CreditKey[] = ['as', 'ip', 'rw', 'im', 'xx']

/**
 * 사건 → 크레딧 키(§3.4). 승인은 xx(=100 고정), 반려·재작업은 rw(결과 단계는 ip).
 * claim 은 종전(플래그 없음) 값이다 — 설계 선행·설계 범위 claim 은 ds, 구현 범위(build) claim 은 dd 를 쓴다(0107·0108).
 * build_start 는 ds·dd 일 때만 ip 로 옮긴다(이미 ip 이상이면 무변경). design_done·design_accept(확정)는 dd.
 */
export type CreditEvent = 'assign' | 'claim' | 'build_start' | 'design_done' | 'design_accept' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release'
export const EVENT_CREDIT: Readonly<Record<CreditEvent, CreditKey>> = {
  assign: 'as', claim: 'ip', build_start: 'ip', design_done: 'dd', design_accept: 'dd', report_completion: 'im', approve: 'xx',
  unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
}
/** 설계 선행 claim 의 크레딧 키. */
export const DESIGN_FIRST_CLAIM_CREDIT: CreditKey = 'ds'

/**
 * 0107·0108 이전에 저장된 표에는 ds·dd 가 없다. ds 는 기본값(10), dd 는 max(ds, min(20, ip-5)) 로 채운다(D18) —
 * RPC 가 표에 없는 키를 채우는 식과 같아 화면과 실제 전이가 어긋나지 않는다.
 */
function fillOptional(o: Record<string, unknown>): Record<string, unknown> {
  const t = { ...o }
  if (t.ds === undefined) t.ds = DEFAULT_STAGE_CREDITS.default.ds
  if (t.dd === undefined && typeof t.ds === 'number' && typeof t.ip === 'number') t.dd = Math.max(t.ds, Math.min(20, t.ip - 5))
  return t
}

type TableResult = { ok: true; table: CreditTable } | { ok: false; error: string }

function validateTable(name: string, raw: unknown): TableResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: `${name} 표는 객체여야 합니다.` }
  for (const k of Object.keys(raw)) {
    if (!(CREDIT_KEYS as readonly string[]).includes(k)) return { ok: false, error: `${name} 표에 모르는 키가 있습니다: ${k}` }
  }
  const o = fillOptional(raw as Record<string, unknown>)
  const t: Partial<CreditTable> = {}
  for (const k of CREDIT_KEYS) {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: `${name}.${k} 는 정수여야 합니다.` }
    if (v < 0 || v > 100) return { ok: false, error: `${name}.${k} 는 0~100 이어야 합니다.` }
    if (v % CREDIT_STEP !== 0) return { ok: false, error: `${name}.${k} 는 ${CREDIT_STEP} 단위여야 합니다.` }
    t[k] = v
  }
  const table = t as CreditTable
  if (table.xx !== 100) return { ok: false, error: `${name}.xx 는 100 이어야 합니다 — 완료는 WBS 완료 판정과 같다.` }
  for (let i = 1; i < CORE_KEYS.length; i++) {
    const prevKey = CORE_KEYS[i - 1], curKey = CORE_KEYS[i]
    if (table[curKey] - table[prevKey] < CREDIT_GAP) {
      return { ok: false, error: `${name}: ${prevKey} < ${curKey} 이고 간격이 ${CREDIT_GAP} 이상이어야 합니다.` }
    }
  }
  if (!(table.as <= table.ds && table.ds <= table.dd && table.dd <= table.ip)) {
    return { ok: false, error: `${name}: as ≤ ds ≤ dd ≤ ip 여야 합니다.` }
  }
  return { ok: true, table }
}

/** 저장 전 검증의 정본 — 서버 액션(updateStageCredits)과 슬라이더가 같이 쓴다. */
export function validateStageCredits(raw: unknown): { ok: true; credits: StageCredits } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '크레딧 표는 객체여야 합니다.' }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (k !== 'default') return { ok: false, error: `모르는 카테고리입니다: ${k}` }
  }
  if (o.default === undefined) return { ok: false, error: 'default 표는 필수입니다.' }
  const v = validateTable('default', o.default)
  if (!v.ok) return v
  return { ok: true, credits: { default: v.table } }
}

/** credits null → 코드 기본값. xx 는 100 고정. 표에 없는 ds·dd 는 fillOptional 과 같은 식(RPC 와 같다). */
export function creditForKey(key: CreditKey, credits: StageCredits | null): number {
  if (key === 'xx') return 100
  const table = fillOptional({ ...((credits ?? DEFAULT_STAGE_CREDITS).default ?? DEFAULT_STAGE_CREDITS.default) })
  const v = table[key]
  return typeof v === 'number' ? v : DEFAULT_STAGE_CREDITS.default[key]
}

/**
 * 저장된 표(project_settings.stage_credits) 읽기 — 없는 선택 키(ds·dd)를 채운다. 검증은 하지 않는다
 * (값의 정본은 DB 이고 저장 때 검증했다). null 은 null(코드 기본값 사용).
 */
export function normalizeStageCredits(raw: StageCredits | null | undefined): StageCredits | null {
  if (!raw || typeof raw !== 'object' || !raw.default || typeof raw.default !== 'object') return raw ?? null
  return { ...raw, default: fillOptional(raw.default as unknown as Record<string, unknown>) as CreditTable }
}

/** 슬라이더 핸들 클램프 — 5 단위 스냅. 핵심 사슬은 이웃과 10 간격, ds·dd 는 as ≤ ds ≤ dd ≤ ip 만(D18). xx 는 100 고정. */
export function clampCredit(raw: number, key: CreditKey, table: CreditTable): number {
  if (key === 'xx') return 100
  const snapped = Number.isFinite(raw) ? Math.round(raw / CREDIT_STEP) * CREDIT_STEP : table[key]
  const bounds: Record<Exclude<CreditKey, 'xx'>, [number, number]> = {
    as: [0, Math.min(table.ds, table.ip - CREDIT_GAP)],
    ds: [table.as, table.dd],
    dd: [table.ds, table.ip],
    ip: [Math.max(table.as + CREDIT_GAP, table.dd), table.rw - CREDIT_GAP],
    rw: [table.ip + CREDIT_GAP, table.im - CREDIT_GAP],
    im: [table.rw + CREDIT_GAP, table.xx - CREDIT_GAP],
  }
  const [lo, hi] = bounds[key]
  return Math.max(lo, Math.min(snapped, hi))
}
