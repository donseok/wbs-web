import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="프로젝트를 불러오는 중">
      {/* 풀폭 히어로 */}
      <Skeleton className="h-[260px] rounded-3xl" />

      {/* KPI 그리드 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>

      {/* 프로젝트 라이브러리 */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-24 rounded" />
            <Skeleton className="h-3.5 w-32 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card flex min-h-[184px] flex-col p-5">
              <div className="flex items-start justify-between">
                <Skeleton className="h-12 w-12 rounded-2xl" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-2/3 rounded" />
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
                <Skeleton className="h-3 w-28 rounded" />
                <Skeleton className="h-3 w-10 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
