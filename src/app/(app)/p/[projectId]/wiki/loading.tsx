import { Skeleton } from '@/components/ui/Skeleton'

// Wiki 세그먼트 폴백 — 검색 페이지 ↔ 토픽 상세(topics/[topicId]) 양방향 이동 모두
// 이 경계가 재마운트되어 클릭 즉시 스켈레톤이 뜬다(2026-08-18 성능 감사: 종전엔 무피드백 동결).
// 2분할(좌 목록 / 우 읽기 패널) 레이아웃과 같은 골격이라 시프트가 없다.
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="프로젝트 Wiki 를 불러오는 중">
      {/* 검색 바 */}
      <Skeleton className="h-11 w-full max-w-xl rounded-xl" />

      {/* 좌 목록 / 우 읽기 패널 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <div className="panel-soft space-y-3 p-5">
          <Skeleton className="h-7 w-2/3 rounded" />
          <Skeleton className="h-4 w-1/3 rounded" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
