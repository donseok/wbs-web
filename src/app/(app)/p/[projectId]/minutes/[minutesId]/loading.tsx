import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="회의록을 불러오는 중">
      <Skeleton className="h-[120px] rounded-3xl" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="card space-y-3 p-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full rounded" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    </div>
  )
}
