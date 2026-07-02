import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="공지사항을 불러오는 중">
      {/* 히어로 + KPI 레일 */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Skeleton className="h-[240px] rounded-3xl" />
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </section>

      {/* 공지 리스트 */}
      <div className="card space-y-3 p-5 sm:p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-2xl border border-line p-4">
            <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
