import { getMembership } from '@/lib/auth'

export default async function Settings({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const m = await getMembership()
  const isPmo = m?.role === 'pmo_admin'
  return (
    <div className="max-w-lg space-y-6">
      <section>
        <h2 className="font-semibold">엑셀 임포트</h2>
        {isPmo ? (
          <form action="/api/import" method="post" encType="multipart/form-data" className="mt-2 flex gap-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="file" name="file" accept=".xlsx" required />
            <button className="bg-black px-3 text-white">업로드</button>
          </form>
        ) : <p className="text-sm text-gray-400">PMO만 가능</p>}
      </section>
      {/* 공휴일 관리/프로젝트 정보는 PMO 전용 폼 — 서버 액션 addHoliday/removeHoliday 추가 */}
    </div>
  )
}
