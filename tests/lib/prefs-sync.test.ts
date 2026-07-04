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

  it('서버 값이 명시적 null 이면 undefined 와 동일하게 "없음"으로 취급해 백필한다', () => {
    // theme 은 타입상 'light' | 'dark' | undefined 이지만, JSONB 컬럼에서 실제로
    // null 이 내려올 수 있어 이를 재현하기 위해 캐스팅한다.
    // 나머지 키는 로컬과 동일하게 채워 theme 의 null 처리만 격리해 검증한다.
    const r = computePrefsSync(
      { ...local, theme: null } as unknown as Parameters<typeof computePrefsSync>[0],
      local,
    )
    expect(r.backfill).toEqual({ theme: local.theme })
    expect(r.apply).toEqual({})
    expect('theme' in r.apply).toBe(false)
  })

  it('boolean 키가 로컬과 다르면 apply 되고, false 를 "없음"으로 오인하지 않는다', () => {
    const r = computePrefsSync({ heroCollapsed: false }, local)
    expect(r.apply).toEqual({ heroCollapsed: false })
    expect('heroCollapsed' in r.backfill).toBe(false)
  })
})
