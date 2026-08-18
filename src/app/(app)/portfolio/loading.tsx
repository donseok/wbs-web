import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-6 pb-10" role="status" aria-label="포트폴리오를 불러오는 중">
      {/* PageHero */}
      <Skeleton className="h-14 w-full rounded-2xl" />
      {/* KPI 4타일 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      {/* 비교 테이블 카드 */}
      <CardSkeleton lines={6} />
      {/* 마일스톤 타임라인 카드 */}
      <CardSkeleton lines={4} />
    </div>
  )
}
