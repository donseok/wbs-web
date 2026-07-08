import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="대시보드를 불러오는 중">
      {/* ExecSummary: 게이지 + 신호등 타일 3 + 공지 슬림바 */}
      <div className="card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
        <div className="grid items-center gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          <Skeleton className="mx-auto h-32 w-32 rounded-full" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        </div>
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      </div>

      {/* 핵심 시각 2개 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>

      {/* 상세 아코디언(접힘) — 헤더 바 3개 */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-2xl" />)}
      </div>
    </div>
  )
}
