import { Skeleton } from '@/components/ui/Skeleton'

// 주간업무 세그먼트 폴백 — 주차 이동(?week=)·타 메뉴 진입 모두 이 경계가 재마운트되어
// 클릭 즉시 스켈레톤이 뜬다(2026-08-18 성능 감사: 종전엔 서버 렌더 동안 화면이 통째로 정지).
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="주간업무 시트를 불러오는 중">
      {/* 주차 헤더 + 컨트롤 */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-64 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>

      {/* 시트 표 — 구분 행 반복 */}
      <div className="panel-soft space-y-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr] gap-3">
            <Skeleton className="h-16 rounded-lg" />
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-16 rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
