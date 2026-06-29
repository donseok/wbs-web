export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" role="status" aria-label="화면을 불러오는 중">
      <div className="h-40 rounded-2xl bg-line/70" />
      <div className="h-12 w-72 rounded-xl bg-line/70" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(item => <div key={item} className="h-32 rounded-2xl bg-line/70" />)}
      </div>
      <div className="h-80 rounded-2xl bg-line/70" />
    </div>
  )
}
