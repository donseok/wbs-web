// DEV PREVIEW ONLY — renders the real WBS.xlsx through the real WBS board
// without Supabase. Safe to delete. Excluded from auth middleware.
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { loadSampleItems, DEMO_TODAY } from './sampleData'

export const dynamic = 'force-dynamic'

export default async function Preview() {
  const { items, holidays } = await loadSampleItems()
  return (
    <div className="p-4">
      <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
        미리보기 — 실제 WBS.xlsx 데이터 + 샘플 실적%, 기준일 {DEMO_TODAY} (Supabase 없이 실제 컴포넌트 렌더)
        · <a className="underline" href="/preview/dashboard">대시보드 미리보기 →</a>
      </div>
      <WbsGanttSheet
        items={items}
        holidays={holidays}
        today={DEMO_TODAY}
        membership={{ role: 'pmo_admin', teamCode: 'PMO', teamId: 'demo' }}
      />
    </div>
  )
}
