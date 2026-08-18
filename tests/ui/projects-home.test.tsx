/**
 * 프로젝트 홈(워크스페이스) — 중복 로드 제거 리팩터 회귀 테스트 (2026-08-18 성능 감사 P1).
 *
 * 종전 페이지는 전 프로젝트의 풀 WBS 트리(getComputedWbs, 프로젝트당 5쿼리)를 다시 로드해
 * 히어로 칩과 상태 배지를 계산했다. 리팩터 후에는
 *   - 상태 배지 = getProjectsCompletion (레이아웃과 동원천, React cache dedupe)
 *   - 히어로 칩 = wbs_items 경량 1쿼리(fetchTaskRows) → 리프/완료 카운트
 * 로 바뀌었다. 이 테스트는 **표시 결과가 구 트리 경로와 동일**함을 구 파이프라인
 * (computeTree → aggregateTaskStats)을 오라클로 삼아 검증한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeTree } from '@/lib/domain/rollup'
import { aggregateTaskStats } from '@/lib/domain/workspace'
import { computeCompletionMap } from '@/lib/domain/project-status'
import { seoulToday } from '@/lib/domain/dates'
import type { WbsRow } from '@/lib/domain/types'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn<() => Promise<unknown[]>>(),
  getActorForView: vi.fn<() => Promise<unknown>>(),
  getProjectsCompletion: vi.fn<() => Promise<unknown>>(),
  select: vi.fn<() => Promise<{ data: unknown[] | null; error: { message: string } | null }>>(),
}))

vi.mock('@/app/actions/project', () => ({
  listProjects: mocks.listProjects,
  createProject: vi.fn(), // NewProjectModal 의 import 바인딩용 — 이 테스트에서 렌더되지 않는다
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: mocks.getProjectsCompletion }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ from: () => ({ select: mocks.select }) }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>{children}</a>
  ),
}))

import ProjectsHome from '@/app/(app)/projects/page'

// ── 픽스처 ──────────────────────────────────────────────────────────────────
// P1: 전 리프 완료(루트 1 + 리프 2) / P2: 미완 리프 2(50, 99.5 — 원시값 done 판정 확인)
// P3: WBS 0건 / PX: 목록에 없는(비공개) 프로젝트 — 집계에서 제외돼야 한다.
const P1 = 'p1'
const P2 = 'p2'
const P3 = 'p3'
const PX = 'px'

// 종료일이 이미 지난 날짜 — projectLifecycleStatus 의 done/overdue 분기를 태운다
const ENDED = { start_date: '2000-01-01', end_date: '2000-12-31' }

const visibleProjects = [
  { id: P1, name: 'Alpha', description: null, ...ENDED },
  { id: P2, name: 'Beta', description: null, ...ENDED },
  { id: P3, name: 'Gamma', description: null, ...ENDED },
]

// DB(wbs_items) 스냅샷 — 페이지의 fetchTaskRows 와 getProjectsCompletion 이 읽는 원천
const dbRows = [
  { id: 'a-root', parent_id: null, project_id: P1, actual_pct: null },
  { id: 'a-1', parent_id: 'a-root', project_id: P1, actual_pct: 100 },
  { id: 'a-2', parent_id: 'a-root', project_id: P1, actual_pct: 100 },
  { id: 'b-1', parent_id: null, project_id: P2, actual_pct: 50 },
  { id: 'b-2', parent_id: null, project_id: P2, actual_pct: 99.5 },
  { id: 'x-1', parent_id: null, project_id: PX, actual_pct: 100 },
]

// 실제 프로덕션 배선과 동일하게, 완료율 맵은 진짜 computeCompletionMap 으로 만든다
const realCompletionMap = () =>
  computeCompletionMap(
    dbRows.map(r => ({
      id: r.id,
      parentId: r.parent_id,
      projectId: r.project_id,
      actualPct: r.actual_pct,
    })),
  )

// ── 구(舊) 파이프라인 오라클: computeTree → aggregateTaskStats ──────────────
function legacyHeroStats() {
  const toWbsRow = (r: (typeof dbRows)[number]): WbsRow => ({
    id: r.id,
    parentId: r.parent_id,
    code: r.id,
    sortOrder: 0,
    name: r.id,
    biz: null,
    deliverable: null,
    plannedStart: null,
    plannedEnd: null,
    weight: null,
    actualPct: r.actual_pct,
    owners: [],
    isOwnerSplit: false,
  })
  const today = seoulToday()
  // 구 코드는 "목록에 있는" 프로젝트만 프로젝트별로 트리를 로드했다
  const trees = visibleProjects.map(p =>
    computeTree(dbRows.filter(r => r.project_id === p.id).map(toWbsRow), today, new Set(), {
      subActTeamOrder: new Map(),
    }),
  )
  return aggregateTaskStats(trees)
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ProjectsHome())
}

function heroValue(markup: string, label: string): string {
  const m = markup.match(new RegExp(`${label}</span><strong[^>]*>([^<]+)</strong>`))
  if (!m) throw new Error(`히어로 칩 ${label} 을 찾지 못했다`)
  return m[1]
}

const count = (markup: string, needle: string) => markup.split(needle).length - 1

beforeEach(() => {
  mocks.listProjects.mockResolvedValue(visibleProjects)
  mocks.getActorForView.mockResolvedValue({ isSuperuser: false })
  mocks.getProjectsCompletion.mockResolvedValue(realCompletionMap())
  mocks.select.mockResolvedValue({ data: dbRows, error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('프로젝트 홈 — 트리 재로드 제거 후 표시 동등성', () => {
  it('히어로 TASKS/DONE/% 가 구 트리 파이프라인(computeTree→aggregateTaskStats)과 일치한다', async () => {
    const legacy = legacyHeroStats()
    // 픽스처 자체 검증: 리프 4(비공개 PX 제외), 완료 2(99.5 는 원시값 미달로 미완), 50%
    expect(legacy).toEqual({ tasks: 4, done: 2, donePct: 50 })

    const markup = await renderPage()
    expect(heroValue(markup, 'Tasks')).toBe(String(legacy.tasks))
    expect(heroValue(markup, 'Done')).toBe(String(legacy.done))
    expect(heroValue(markup, '%')).toBe(`${legacy.donePct}%`)
  })

  it('상태 배지: 전 리프 완료=done, 미완=overdue, WBS 0건+종료일 경과=done (구 경로와 동일 판정)', async () => {
    const markup = await renderPage()
    // P1(전 리프 100) + P3(WBS 없음 — 날짜 기준 유지) = done 2, P2(미완) = overdue 1
    expect(count(markup, 'bg-done-weak')).toBe(2)
    expect(count(markup, 'bg-delayed-weak')).toBe(1)
    expect(count(markup, 'bg-surface-2 text-ink-muted')).toBe(0) // unknown 없음
  })

  it('완료율 맵 조회 실패(null)면 전 카드가 unknown — WBS 없음(빈 맵)으로 뭉개지 않는다', async () => {
    mocks.getProjectsCompletion.mockResolvedValue(null)
    const markup = await renderPage()
    expect(count(markup, 'bg-surface-2 text-ink-muted')).toBe(3)
    expect(count(markup, 'bg-done-weak')).toBe(0)
    // 히어로 쿼리는 별개 경로 — 정상 집계 유지
    expect(heroValue(markup, 'Tasks')).toBe('4')
  })

  it('wbs_items 조회 실패면 히어로를 0 으로 위장하지 않고 – 를 그린다(표시 = 로깅)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.select.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const markup = await renderPage()
    expect(heroValue(markup, 'Tasks')).toBe('–')
    expect(heroValue(markup, 'Done')).toBe('–')
    expect(heroValue(markup, '%')).toBe('–')
    // 배지는 getProjectsCompletion 경로라 영향 없음
    expect(count(markup, 'bg-done-weak')).toBe(2)
    expect(errSpy).toHaveBeenCalled()
  })
})
