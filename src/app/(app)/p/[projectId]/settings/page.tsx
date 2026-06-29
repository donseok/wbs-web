import { getMembership } from '@/lib/auth'

export default async function Settings({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const m = await getMembership()
  const isPmo = m?.role === 'pmo_admin'
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">설정</h1>
        <p className="mt-1 text-sm text-ink-muted">프로젝트 데이터와 일정 기준을 관리합니다.</p>
      </div>

      <section className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">엑셀 임포트</h2>
            <p className="mt-1 text-sm text-ink-muted">WBS.xlsx 파일을 업로드해 작업 구조를 갱신합니다.</p>
          </div>
          {!isPmo && <span className="badge bg-pending-weak text-pending">PMO 전용</span>}
        </div>
        {isPmo ? (
          <form action="/api/import" method="post" encType="multipart/form-data" className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input
              type="file"
              name="file"
              accept=".xlsx"
              required
              className="text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
            />
            <button className="btn btn-primary">업로드</button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-ink-subtle">PMO 관리자만 업로드할 수 있습니다.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">공휴일 / 프로젝트 정보</h2>
        <p className="mt-1 text-sm text-ink-muted">간트 차트의 비근무일 음영에 사용됩니다.</p>
        <p className="mt-4 text-sm text-ink-subtle">곧 제공될 예정입니다.</p>
      </section>
    </div>
  )
}
