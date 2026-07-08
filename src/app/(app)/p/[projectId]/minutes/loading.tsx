import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="회의록을 불러오는 중">
      {/* 히어로 + KPI 레일 — announcements/loading.tsx 와 동일 골격 */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Skeleton className="h-[240px] rounded-3xl" />
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </section>

      {/* 회의록 리스트 */}
      <div className="card space-y-3 p-5 sm:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-line p-4">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
