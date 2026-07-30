import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  USAGE_MENUS, resolveMenuKey, normalizeUsagePath, extractProjectId, menuLabel,
} from '@/lib/domain/usageMenu'

const PID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('resolveMenuKey — 경로를 메뉴 키로', () => {
  it.each([
    [`/p/${PID}/dashboard`, 'dashboard'],
    [`/p/${PID}/wbs`, 'wbs'],
    [`/p/${PID}/wbs?view=gantt`, 'wbs'],
    [`/p/${PID}/kanban`, 'kanban'],
    [`/p/${PID}/settings`, 'settings'],
    [`/p/${PID}/wiki/some-topic`, 'wiki'],
    ['/minutes', 'minutes'],
    ['/minutes/abc', 'minutes'],
    ['/meetings', 'my-meetings'],
    ['/projects', 'projects'],
    ['/usage', 'usage'],
    ['/admin/accounts', 'admin-accounts'],
    ['/admin/teams', 'admin-teams'],
    ['/admin/llm-config', 'admin-llm'],
  ])('%s → %s', (path, key) => {
    expect(resolveMenuKey(path)).toBe(key)
  })

  it.each([
    [`/p/${PID}`],
    [`/p/${PID}/무언가새로생긴메뉴`],
    ['/login'],
    ['/'],
    ['/share/minutes/tok'],
  ])('모르는 경로(%s)는 추측하지 않고 unknown', (path) => {
    expect(resolveMenuKey(path)).toBe('unknown')
  })

  it('모든 반환 키는 USAGE_MENUS 에 정의돼 있다', () => {
    const keys = new Set(USAGE_MENUS.map(m => m.key))
    for (const p of [`/p/${PID}/issues`, '/minutes', '/usage', '/nope']) {
      expect(keys.has(resolveMenuKey(p))).toBe(true)
    }
  })
})

describe('드리프트 가드 — 사이드바 메뉴가 전부 해석된다', () => {
  it('Sidebar.tsx 의 프로젝트 메뉴 href 가 하나도 unknown 이 아니다', () => {
    const src = readFileSync(
      new URL('../../src/components/app/Sidebar.tsx', import.meta.url),
      'utf8',
    )
    const segments = [...src.matchAll(/href:\s*`\$\{base\}\/([a-z-]+)`/g)].map(m => m[1])
    expect(segments.length).toBeGreaterThanOrEqual(11) // 현재 11개 — 줄면 정규식이 깨진 것
    for (const seg of segments) {
      expect(resolveMenuKey(`/p/${PID}/${seg}`)).not.toBe('unknown')
    }
  })
})

describe('normalizeUsagePath — UUID 를 지우고 길이를 제한', () => {
  it('UUID 를 :id 로 바꾼다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs`)).toBe('/p/:id/wbs')
  })
  it('쿼리스트링과 해시를 버린다', () => {
    expect(normalizeUsagePath(`/p/${PID}/wbs?view=gantt#x`)).toBe('/p/:id/wbs')
  })
  it('200자를 넘기지 않는다', () => {
    expect(normalizeUsagePath('/a' + 'b'.repeat(500)).length).toBe(200)
  })
})

describe('extractProjectId', () => {
  it('프로젝트 스코프 경로에서 id 를 뽑는다', () => {
    expect(extractProjectId(`/p/${PID}/wbs`)).toBe(PID)
  })
  it('전역 경로는 null', () => {
    expect(extractProjectId('/minutes')).toBeNull()
    expect(extractProjectId('/p/not-a-uuid/wbs')).toBeNull()
  })
})

describe('menuLabel', () => {
  it('labelKey 가 있으면 번역기를 쓴다', () => {
    expect(menuLabel('dashboard', () => '번역됨')).toBe('번역됨')
  })
  it('i18n 이 없는 관리자 메뉴는 fallback 을 쓴다', () => {
    expect(menuLabel('admin-accounts', () => '번역됨')).toBe('계정 관리')
  })
  it('정의에 없는 키는 키 자체를 돌려준다(추측 금지)', () => {
    expect(menuLabel('zzz', () => '번역됨')).toBe('zzz')
  })
})
