import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="이슈를 불러오는 중">
      <Skeleton className="h-[140px] rounded-3xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
      <div className="card space-y-2.5 overflow-x-auto p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-w-[1000px] items-center gap-2.5">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-6 w-20 rounded-lg" />
            <Skeleton className="h-4 flex-1 rounded" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
