import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 2026-08-18 부터 디바운스 저장은 서버 액션이 아니라 /api/prefs POST 다 — 액션은 성공마다
// 클라이언트 라우터 캐시를 비워 staleTimes 재방문 캐시를 무효화했기 때문(라우트는 무관).
const fetchMock = vi.fn(async () => ({ ok: true }) as Response)

import { queueUiPref, queueWbsCollapse } from '@/lib/prefs/debouncedSave'

function sentBodies(): unknown[] {
  return fetchMock.mock.calls.map(c => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('queueUiPref', () => {
  it('연속 호출을 병합해 delay 후 /api/prefs 1회만 저장한다', () => {
    queueUiPref({ theme: 'dark' })
    queueUiPref({ locale: 'en' })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/prefs')
    expect(init.method).toBe('POST')
    // keepalive: 페이지 이탈 직전의 저장도 유실되지 않는 계약
    expect((init as { keepalive?: boolean }).keepalive).toBe(true)
    expect(JSON.parse(init.body as string)).toEqual({ prefs: { theme: 'dark', locale: 'en' } })
  })
})

describe('queueWbsCollapse', () => {
  it('프로젝트별로 최신값만 저장하고 서로 격리된다', () => {
    queueWbsCollapse('p1', ['a'])
    queueWbsCollapse('p1', ['a', 'b']) // 최신값이 이김
    queueWbsCollapse('p2', ['x'])
    vi.advanceTimersByTime(600)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentBodies()).toEqual(expect.arrayContaining([
      { wbsCollapse: { projectId: 'p1', ids: ['a', 'b'] } },
      { wbsCollapse: { projectId: 'p2', ids: ['x'] } },
    ]))
  })
})
