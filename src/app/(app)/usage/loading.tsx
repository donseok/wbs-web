/** /usage 스켈레톤 — 실제 레이아웃(요약 4칸 → 2열 카드 → 표 2개)을 모사한다. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="사용 현황 불러오는 중">
      <div className="hero-card h-16 animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="kpi-card h-24 animate-pulse" />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card h-64 animate-pulse" />
        <div className="card h-64 animate-pulse" />
      </div>
      <div className="card h-72 animate-pulse" />
    </div>
  )
}
