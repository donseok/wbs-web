// 실적 크레딧 표(스펙 2026-09-15 §3.3·§3.4) — 검증·사건 매핑·슬라이더 클램프.
import { describe, expect, it } from 'vitest'
import {
  CREDIT_KEYS, DEFAULT_STAGE_CREDITS, EVENT_CREDIT, clampCredit, creditForKey, normalizeStageCredits, validateStageCredits,
} from '@/lib/domain/stageCredits'

describe('validateStageCredits', () => {
  it('기본값은 유효하다', () => {
    expect(validateStageCredits(DEFAULT_STAGE_CREDITS)).toEqual({ ok: true, credits: DEFAULT_STAGE_CREDITS })
  })
  it('default 표만 있어도 유효하다', () => {
    const only = { default: { as: 0, ds: 10, ip: 30, rw: 50, im: 80, xx: 100 } }
    expect(validateStageCredits(only)).toEqual({ ok: true, credits: only })
  })
  it('키 순서는 as·ds·ip·rw·im·xx, 기본값 ds 는 10(0107)', () => {
    expect([...CREDIT_KEYS]).toEqual(['as', 'ds', 'ip', 'rw', 'im', 'xx'])
    expect(DEFAULT_STAGE_CREDITS.default).toEqual({ as: 0, ds: 10, ip: 30, rw: 50, im: 80, xx: 100 })
  })
  it('ds 가 없는 옛 표는 ds 를 기본값(10)으로 채워 받는다 — RPC 의 coalesce 와 같은 값', () => {
    expect(validateStageCredits({ default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 } }))
      .toEqual({ ok: true, credits: DEFAULT_STAGE_CREDITS })
  })
  it('채운 ds 가 이웃 간격을 어기면 거부한다(ip 20 미만인 옛 표 — 사람이 ip 를 옮겨야 저장된다)', () => {
    expect(validateStageCredits({ default: { as: 0, ip: 10, rw: 50, im: 80, xx: 100 } })).toMatchObject({ ok: false })
  })
  it('default 표가 없으면 거부', () => {
    expect(validateStageCredits({})).toMatchObject({ ok: false })
  })
  it.each([
    ['정수 아님', { as: 0, ds: 10, ip: 30.5, rw: 50, im: 80, xx: 100 }],
    ['5 단위 아님', { as: 0, ds: 10, ip: 32, rw: 50, im: 80, xx: 100 }],
    ['순서 역전', { as: 0, ds: 10, ip: 60, rw: 50, im: 80, xx: 100 }],
    ['간격 10 미만', { as: 0, ds: 10, ip: 30, rw: 35, im: 80, xx: 100 }],
    ['ds 간격 10 미만', { as: 0, ds: 25, ip: 30, rw: 50, im: 80, xx: 100 }],
    ['xx 가 100 아님', { as: 0, ds: 10, ip: 30, rw: 50, im: 80, xx: 95 }],
    ['키 누락', { as: 0, ds: 10, ip: 30, rw: 50, im: 80 }],
    ['ds 가 정수 아님', { as: 0, ds: 'x', ip: 30, rw: 50, im: 80, xx: 100 }],
    ['음수', { as: -10, ds: 10, ip: 30, rw: 50, im: 80, xx: 100 }],
  ])('%s 이면 거부', (_name, table) => {
    expect(validateStageCredits({ default: table })).toMatchObject({ ok: false })
  })
  it('모르는 표 키나 모르는 카테고리는 거부', () => {
    expect(validateStageCredits({ default: { ...DEFAULT_STAGE_CREDITS.default, zz: 1 } })).toMatchObject({ ok: false })
    expect(validateStageCredits({ default: DEFAULT_STAGE_CREDITS.default, etc: DEFAULT_STAGE_CREDITS.default })).toMatchObject({ ok: false })
  })
  it('객체가 아니면 거부', () => {
    expect(validateStageCredits(null)).toMatchObject({ ok: false })
    expect(validateStageCredits([1, 2])).toMatchObject({ ok: false })
  })
})

describe('creditForKey — 사건 표', () => {
  it('사건 → 크레딧 키 매핑', () => {
    expect(EVENT_CREDIT).toEqual({
      assign: 'as', claim: 'ip', build_start: 'ip', report_completion: 'im', approve: 'xx',
      unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
    })
  })
  it('credits null 이면 코드 기본값, 있으면 그 표(2026-09-16 부터 표는 하나)', () => {
    expect(creditForKey('rw', null)).toBe(50)
    expect(creditForKey('ip', null)).toBe(30)
    expect(creditForKey('ds', null)).toBe(10)
    expect(creditForKey('im', { default: { as: 0, ds: 10, ip: 20, rw: 30, im: 40, xx: 100 } })).toBe(40)
  })
  it('ds 가 없는 옛 표에서 ds 는 기본값 10 — RPC 가 c_default 로 채우는 값과 같다', () => {
    const old = { default: { as: 0, ip: 40, rw: 50, im: 80, xx: 100 } } as unknown as Parameters<typeof creditForKey>[1]
    expect(creditForKey('ds', old)).toBe(10)
    expect(creditForKey('ip', old)).toBe(40)
  })
  it('xx 는 항상 100', () => {
    expect(creditForKey('xx', { default: { as: 0, ds: 10, ip: 20, rw: 30, im: 40, xx: 100 } })).toBe(100)
  })
})

describe('clampCredit — 슬라이더 핸들 제약', () => {
  const t = { as: 0, ds: 10, ip: 30, rw: 50, im: 80, xx: 100 }
  it('5 단위로 스냅하고 이웃과 10 간격을 지킨다', () => {
    expect(clampCredit(42, 'ip', t)).toBe(40)
    expect(clampCredit(48, 'ip', t)).toBe(40)   // rw(50) - 10
    expect(clampCredit(3, 'ip', t)).toBe(20)    // ds(10) + 10
    expect(clampCredit(27, 'ds', t)).toBe(20)   // ip(30) - 10
    expect(clampCredit(-3, 'ds', t)).toBe(10)   // as(0) + 10
    expect(clampCredit(-7, 'as', t)).toBe(0)
    expect(clampCredit(95, 'im', t)).toBe(90)   // xx(100) - 10
  })
  it('xx 는 100 고정', () => {
    expect(clampCredit(10, 'xx', t)).toBe(100)
  })
})

describe('normalizeStageCredits — 저장된 표 읽기(0107 이전 표 호환)', () => {
  it('null 은 null(코드 기본값 사용)', () => {
    expect(normalizeStageCredits(null)).toBeNull()
  })
  it('ds 가 없으면 기본값 10 으로 채운다 — 다른 값은 그대로', () => {
    expect(normalizeStageCredits({ default: { as: 0, ip: 40, rw: 50, im: 80, xx: 100 } } as never))
      .toEqual({ default: { as: 0, ds: 10, ip: 40, rw: 50, im: 80, xx: 100 } })
  })
  it('ds 가 있으면 그대로', () => {
    const t = { default: { as: 0, ds: 15, ip: 30, rw: 50, im: 80, xx: 100 } }
    expect(normalizeStageCredits(t)).toEqual(t)
  })
})
