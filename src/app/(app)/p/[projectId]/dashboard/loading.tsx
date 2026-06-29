import { Skeleton, KpiSkeleton, CardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="대시보드를 불러오는 중">
      {/* 히어로 + KPI 레일 */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <Skeleton className="h-[280px] rounded-3xl" />
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </section>

      {/* 진척 요약 카드 + 분포 카드 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>

      {/* 하단 와이드 카드 */}
      <CardSkeleton lines={6} />
    </div>
  )
}
