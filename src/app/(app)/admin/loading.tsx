import { Skeleton } from '@/components/ui/Skeleton'

// admin 세그먼트 폴백 — accounts ↔ teams ↔ llm-config 형제 이동에서 자식 키가 바뀌며
// 재마운트되어 즉시 폴백이 뜬다(2026-08-18 성능 감사: 종전엔 무피드백).
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="관리 화면을 불러오는 중">
      <Skeleton className="h-9 w-52 rounded-xl" />
      <div className="panel-soft space-y-2.5 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
