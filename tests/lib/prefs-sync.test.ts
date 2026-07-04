import { describe, it, expect } from 'vitest'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'

const local: LocalPrefs = { heroCollapsed: true, sidebarCollapsed: false, theme: 'light', locale: 'ko' }

describe('computePrefsSync', () => {
  it('서버가 비어있으면 로컬 전체를 백필하고 apply 없음', () => {
    const r = computePrefsSync({}, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual(local)
  })

  it('서버 값이 로컬과 다르면 apply, 같으면 무시', () => {
    const r = computePrefsSync({ theme: 'dark', locale: 'ko' }, local)
    expect(r.apply).toEqual({ theme: 'dark' })          // theme 다름 → 적용
    expect(r.backfill).toEqual({ heroCollapsed: true, sidebarCollapsed: false }) // 서버에 없는 것만
    expect('locale' in r.apply).toBe(false)              // locale 같음 → 무시
    expect('locale' in r.backfill).toBe(false)
  })

  it('서버 값이 로컬과 전부 같으면 apply·backfill 모두 비어있음', () => {
    const r = computePrefsSync({ ...local }, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual({})
  })
})
