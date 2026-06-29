import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="칸반 보드를 불러오는 중">
      {/* 히어로 + KPI 레일 */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Skeleton className="h-[240px] rounded-3xl" />
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </section>

      {/* 보드 컨트롤 */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-10 w-56 rounded-xl" />
        <Skeleton className="h-10 w-40 rounded-xl" />
      </div>

      {/* 컬럼들 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="panel-soft p-3">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-5 w-6 rounded-md" />
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, card) => (
                <Skeleton key={card} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
