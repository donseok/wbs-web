// DEV PREVIEW ONLY — renders the dashboard with real WBS.xlsx + sample actuals,
// no Supabase. Safe to delete. Excluded from auth middleware.
import { DashboardView } from '@/components/dashboard/DashboardView'
import { loadSampleItems, DEMO_TODAY } from '../sampleData'

export const dynamic = 'force-dynamic'

export default async function PreviewDashboard() {
  const { items } = await loadSampleItems()
  return (
    <div className="p-4">
      <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
        대시보드 미리보기 — 실제 WBS.xlsx 데이터 + 샘플 실적%, 기준일 {DEMO_TODAY}
        · <a className="underline" href="/preview">← WBS 보드 미리보기</a>
      </div>
      <DashboardView items={items} />
    </div>
  )
}
