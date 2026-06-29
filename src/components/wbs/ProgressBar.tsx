export function ProgressBar({ planned, actual }: { planned: number; actual: number }) {
  const delayed = actual < planned
  return (
    <div className="relative h-3 w-24 rounded bg-gray-200">
      <div className="absolute h-3 rounded bg-gray-400/40" style={{ width: `${planned}%` }} />
      <div className={`absolute h-3 rounded ${delayed ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${actual}%` }} />
    </div>
  )
}
