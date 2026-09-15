/**
 * 실적 크레딧 표(스펙 2026-09-15 §3.3·§3.4) — 순수 함수. 값의 정본은 DB(project_settings.stage_credits)이고
 * 전이 때 실제 계산은 RPC apply_workflow_event 가 한다. 여기 기본값·규칙은 그 SQL 과 같아야 한다
 * (tests/migrations/0096-wbs-stage-credits.test.ts 가 SQL 상수와 비교한다).
 */
export const CREDIT_KEYS = ['as', 'ip', 'rw', 'im', 'xx'] as const
export type CreditKey = (typeof CREDIT_KEYS)[number]
export type CreditTable = Record<CreditKey, number>
export const CREDIT_TABLE_KEYS = ['default', 'if', 'doc'] as const
export type CreditTableKey = (typeof CREDIT_TABLE_KEYS)[number]
export type StageCredits = { default: CreditTable; if?: CreditTable; doc?: CreditTable }

export const DEFAULT_STAGE_CREDITS: StageCredits = {
  default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 },
  if: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
  doc: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
}
export const CREDIT_STEP = 5
export const CREDIT_GAP = 10

/** 사건 → 크레딧 키(§3.4). 승인은 xx(=100 고정), 반려·재작업은 rw(결과 단계는 ip). */
export type CreditEvent = 'assign' | 'claim' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release'
export const EVENT_CREDIT: Readonly<Record<CreditEvent, CreditKey>> = {
  assign: 'as', claim: 'ip', report_completion: 'im', approve: 'xx',
  unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
}

type TableResult = { ok: true; table: CreditTable } | { ok: false; error: string }

function validateTable(name: string, raw: unknown): TableResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: `${name} 표는 객체여야 합니다.` }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!(CREDIT_KEYS as readonly string[]).includes(k)) return { ok: false, error: `${name} 표에 모르는 키가 있습니다: ${k}` }
  }
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
  for (let i = 1; i < CREDIT_KEYS.length; i++) {
    const prevKey = CREDIT_KEYS[i - 1], curKey = CREDIT_KEYS[i]
    if (table[curKey] - table[prevKey] < CREDIT_GAP) {
      return { ok: false, error: `${name}: ${prevKey} < ${curKey} 이고 간격이 ${CREDIT_GAP} 이상이어야 합니다.` }
    }
  }
  return { ok: true, table }
}

/** 저장 전 검증의 정본 — 서버 액션(updateStageCredits)과 슬라이더가 같이 쓴다. */
export function validateStageCredits(raw: unknown): { ok: true; credits: StageCredits } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '크레딧 표는 객체여야 합니다.' }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!(CREDIT_TABLE_KEYS as readonly string[]).includes(k)) return { ok: false, error: `모르는 카테고리입니다: ${k}` }
  }
  if (o.default === undefined) return { ok: false, error: 'default 표는 필수입니다.' }
  const out: Partial<StageCredits> = {}
  for (const k of CREDIT_TABLE_KEYS) {
    if (o[k] === undefined) continue
    const v = validateTable(k, o[k])
    if (!v.ok) return v
    out[k] = v.table
  }
  return { ok: true, credits: out as StageCredits }
}

/** credits null → 코드 기본값. 항목 credit_key 가 표에 없으면 default. xx 는 100 고정. */
export function creditForKey(key: CreditKey, credits: StageCredits | null, creditKey: string | null): number {
  if (key === 'xx') return 100
  const src = credits ?? DEFAULT_STAGE_CREDITS
  const byKey = creditKey && (CREDIT_TABLE_KEYS as readonly string[]).includes(creditKey)
    ? src[creditKey as CreditTableKey]
    : undefined
  const table = byKey ?? src.default ?? DEFAULT_STAGE_CREDITS.default
  return table[key]
}

/** 슬라이더 핸들 클램프 — 5 단위 스냅, 이웃 핸들과 10 간격, xx 는 100 고정. */
export function clampCredit(raw: number, key: CreditKey, table: CreditTable): number {
  if (key === 'xx') return 100
  const i = CREDIT_KEYS.indexOf(key)
  const snapped = Number.isFinite(raw) ? Math.round(raw / CREDIT_STEP) * CREDIT_STEP : table[key]
  const lo = i === 0 ? 0 : table[CREDIT_KEYS[i - 1]] + CREDIT_GAP
  const hi = table[CREDIT_KEYS[i + 1]] - CREDIT_GAP
  return Math.max(lo, Math.min(snapped, hi))
}
