// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode, AnchorHTMLAttributes } from 'react'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const saveWeeklyCells = vi.fn(async (): Promise<unknown> => ({ ok: true }))
const previewWeeklyFormat = vi.fn(async (): Promise<unknown> => ({ ok: true, edits: [] }))
vi.mock('@/app/actions/weekly', () => ({
  createWeeklyReport: vi.fn(async () => ({ ok: true })),
  saveWeeklyCell: vi.fn(async () => ({ ok: true })),
  saveWeeklyCells: (...a: unknown[]) => saveWeeklyCells(...(a as [])),
  saveWeeklyTitle: vi.fn(async () => ({ ok: true })),
  previewWeeklyFormat: (...a: unknown[]) => previewWeeklyFormat(...(a as [])),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...rest}>{children}</a>
  ),
}))
// Modal이 useLocale을 쓴다 — 실제 LocaleProvider 대신 기존 UI 테스트 관례대로 모킹
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))
vi.mock('@/lib/supabase/client', () => {
  const chan = {
    on: () => chan, subscribe: () => chan, presenceState: () => ({}),
    track: async () => {}, unsubscribe: async () => {},
  }
  return { createBrowserClient: () => ({ channel: () => chan, removeChannel: vi.fn() }) }
})

import { WeeklySheetView } from '@/components/weekly/WeeklySheetView'
import { ToastProvider } from '@/components/ui/Toast'

const MESSY = '1. Program Check List 점검 작업\n-CBO Program, Function, Table'
const CLEAN = '1. Program Check List 점검 작업\n  -. CBO Program, Function, Table'
const EDIT = { rowId: 'row1', cellKey: 'this_content', section: 'PMO', before: MESSY, after: CLEAN }

function row(over: Partial<WeeklySheetRow>): WeeklySheetRow {
  return {
    id: 'row1', reportId: 'r1', section: 'PMO', module: '', sortOrder: 0,
    thisContent: MESSY, thisIssue: '', nextContent: '', nextIssue: '', ...over,
  }
}

const baseProps = {
  projectId: 'p1', weekStart: '2026-07-13', weekLabel: '7월 3주차', weekTitle: '7월 3주차',
  thisRange: '7/13~7/17', nextRange: '7/20~7/24', projectName: 'D-CUBE',
  hasCarrySource: false, me: { id: 'u1', name: '제리' },
}

describe('주간업무 — 양식 통일 버튼', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    saveWeeklyCells.mockClear()
    previewWeeklyFormat.mockClear()
    previewWeeklyFormat.mockResolvedValue({ ok: true, edits: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const mount = async (report: { id: string; title: string } | null, rows: WeeklySheetRow[]) =>
    act(async () =>
      root.render(
        <ToastProvider>
          <WeeklySheetView {...baseProps} report={report} initialRows={rows} />
        </ToastProvider>,
      ),
    )
  // 모달은 portal로 body에 렌더되므로 버튼 탐색은 document 전역으로
  const btn = (re: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => re.test(b.textContent ?? ''))

  it('미리보기 → 적용: 모달에 전/후를 보여주고 after 값으로 saveWeeklyCells 호출', async () => {
    previewWeeklyFormat.mockResolvedValueOnce({ ok: true, edits: [EDIT] })
    await mount({ id: 'r1', title: '' }, [row({})])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(previewWeeklyFormat).toHaveBeenCalledWith('p1', 'r1')
    expect(document.body.textContent).toContain('양식 통일 미리보기')
    expect(document.body.textContent).toContain('PMO · 금주실적 내용')
    expect(document.body.textContent).toContain('-CBO Program')      // 전
    expect(document.body.textContent).toContain('-. CBO Program')    // 후
    await act(async () => { btn(/1개 셀 적용/)!.click() })
    expect(saveWeeklyCells).toHaveBeenCalledWith('p1', [
      { rowId: 'row1', cellKey: 'this_content', content: CLEAN },
    ])
    expect(document.body.textContent).not.toContain('양식 통일 미리보기') // 모달 닫힘
  })

  it('변경 0건이면 모달 없이 안내 토스트', async () => {
    await mount({ id: 'r1', title: '' }, [row({ thisContent: '1. 정상' })])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(document.body.textContent).toContain('이미 통일된 양식입니다')
    expect(document.body.textContent).not.toContain('양식 통일 미리보기')
    expect(saveWeeklyCells).not.toHaveBeenCalled()
  })

  it('미리보기 실패면 에러 토스트', async () => {
    previewWeeklyFormat.mockResolvedValueOnce({ ok: false, error: '서버 오류' })
    await mount({ id: 'r1', title: '' }, [row({})])
    await act(async () => { btn(/양식 통일/)!.click() })
    expect(document.body.textContent).toContain('양식 검사 실패')
  })

  it('시트가 없는 주(EmptyState)에는 양식 통일 비활성', async () => {
    await mount(null, [])
    expect(btn(/양식 통일/)!.disabled).toBe(true)
  })
})
