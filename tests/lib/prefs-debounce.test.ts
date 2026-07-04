import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const saveUiPrefs = vi.fn(async () => {})
const saveWbsCollapse = vi.fn(async () => {})
vi.mock('@/app/actions/preferences', () => ({
  saveUiPrefs: (...a: unknown[]) => saveUiPrefs(...(a as [])),
  saveWbsCollapse: (...a: unknown[]) => saveWbsCollapse(...(a as [])),
}))

import { queueUiPref, queueWbsCollapse } from '@/lib/prefs/debouncedSave'

beforeEach(() => { vi.useFakeTimers(); saveUiPrefs.mockClear(); saveWbsCollapse.mockClear() })
afterEach(() => { vi.useRealTimers() })

describe('queueUiPref', () => {
  it('연속 호출을 병합해 delay 후 1회만 저장한다', () => {
    queueUiPref({ theme: 'dark' })
    queueUiPref({ locale: 'en' })
    expect(saveUiPrefs).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(saveUiPrefs).toHaveBeenCalledTimes(1)
    expect(saveUiPrefs).toHaveBeenCalledWith({ theme: 'dark', locale: 'en' })
  })
})

describe('queueWbsCollapse', () => {
  it('프로젝트별로 최신값만 저장하고 서로 격리된다', () => {
    queueWbsCollapse('p1', ['a'])
    queueWbsCollapse('p1', ['a', 'b']) // 최신값이 이김
    queueWbsCollapse('p2', ['x'])
    vi.advanceTimersByTime(600)
    expect(saveWbsCollapse).toHaveBeenCalledTimes(2)
    expect(saveWbsCollapse).toHaveBeenCalledWith('p1', ['a', 'b'])
    expect(saveWbsCollapse).toHaveBeenCalledWith('p2', ['x'])
  })
})
