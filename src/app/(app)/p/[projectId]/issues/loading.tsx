import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="이슈를 불러오는 중">
      <Skeleton className="h-[140px] rounded-3xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
      <div className="card space-y-2.5 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="grid items-center gap-2.5"
            style={{ gridTemplateColumns: '12fr 10fr 28fr 7fr 7fr 17fr 10fr 9fr' }}
          >
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-6 w-full rounded-lg" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-5 w-full rounded-full" />
            <Skeleton className="h-5 w-full rounded-full" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
