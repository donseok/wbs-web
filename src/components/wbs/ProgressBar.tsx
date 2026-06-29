export function ProgressBar({ planned, actual }: { planned: number; actual: number }) {
  const delayed = actual < planned
  return (
    <div className="relative h-2.5 w-full min-w-[80px] overflow-hidden rounded-full bg-line">
      {/* 계획 (옅은 트랙) */}
      <div className="absolute inset-y-0 left-0 rounded-full bg-line-strong/70" style={{ width: `${planned}%` }} />
      {/* 실적 */}
      <div className={`absolute inset-y-0 left-0 rounded-full ${delayed ? 'bg-delayed' : 'bg-done'}`} style={{ width: `${actual}%` }} />
    </div>
  )
}
