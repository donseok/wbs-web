import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_CATALOG, categoryOf, isTypeEnabled, normalizeRecipientUserIds,
} from '@/lib/domain/inbox'

describe('notification catalog', () => {
  it('전 타입이 5개 카테고리 안에 있다', () => {
    const cats = new Set(Object.values(NOTIFICATION_CATALOG).map(c => c.category))
    for (const c of cats) expect(['work', 'issue', 'meeting', 'announce', 'system']).toContain(c)
  })
  it('REQUIRED 는 승인 요청류 둘뿐이다', () => {
    const required = Object.entries(NOTIFICATION_CATALOG).filter(([, c]) => c.required).map(([t]) => t)
    expect(required.sort()).toEqual(['work.rejected', 'work.reported'])
  })
  it('categoryOf — issue.assigned 는 issue', () => {
    expect(categoryOf('issue.assigned')).toBe('issue')
  })
})

describe('isTypeEnabled — 조회 시점 필터', () => {
  it('prefs 없으면 카탈로그 기본값', () => {
    expect(isTypeEnabled(undefined, 'issue.assigned')).toBe(true)
    expect(isTypeEnabled(undefined, 'work.progress')).toBe(false)
  })
  it('prefs 가 기본값을 뒤집는다', () => {
    expect(isTypeEnabled({ 'issue.assigned': false }, 'issue.assigned')).toBe(false)
    expect(isTypeEnabled({ 'work.progress': true }, 'work.progress')).toBe(true)
  })
  it('REQUIRED 는 끌 수 없다', () => {
    expect(isTypeEnabled({ 'work.reported': false }, 'work.reported')).toBe(true)
  })
  it('카탈로그 밖 타입은 false — throw 없이 fail-closed', () => {
    const unknown = 'meeting.unknown' as unknown as import('@/lib/domain/inbox').NotificationType
    expect(() => isTypeEnabled(undefined, unknown)).not.toThrow()
    expect(isTypeEnabled(undefined, unknown)).toBe(false)
  })
})

describe('normalizeRecipientUserIds', () => {
  it('중복·null 제거, 행위자 제외', () => {
    expect(normalizeRecipientUserIds(['u1', 'u1', null, 'u2', 'u3'], 'u2')).toEqual(['u1', 'u3'])
  })
  it('행위자 없으면 전원 유지', () => {
    expect(normalizeRecipientUserIds(['u1', 'u2'], null)).toEqual(['u1', 'u2'])
  })
})
