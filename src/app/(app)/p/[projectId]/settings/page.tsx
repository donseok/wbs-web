import { getMembership } from '@/lib/auth'
import { Icon } from '@/components/ui/Icon'

export default async function Settings({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const membership = await getMembership()
  const isPmo = membership?.role === 'pmo_admin'

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <div className="eyebrow">Project administration</div>
        <h2 className="mt-1.5 text-xl font-bold tracking-tight text-ink">프로젝트 설정</h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">WBS 원본 데이터와 프로젝트 기준 정보를 관리합니다.</p>
      </header>

      <section className="card overflow-hidden" aria-labelledby="import-title">
        <div className="flex flex-col gap-3 border-b border-line bg-surface-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon name="upload" /></span>
            <div><h3 id="import-title" className="text-sm font-semibold text-ink">WBS 데이터 가져오기</h3><p className="mt-1 text-xs leading-5 text-ink-muted">Excel 형식의 작업 구조와 일정을 프로젝트에 반영합니다.</p></div>
          </div>
          {!isPmo && <span className="badge w-fit bg-pending-weak px-2 py-1 text-pending">PMO 관리자 전용</span>}
        </div>
        <div className="p-5">
          {isPmo ? (
            <form action="/api/import" method="post" encType="multipart/form-data">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 px-6 text-center transition hover:border-brand hover:bg-brand-weak/40">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-sm transition group-hover:border-brand-ring"><Icon name="upload" /></span>
                <span className="mt-4 text-sm font-semibold text-ink">WBS Excel 파일을 선택하세요</span>
                <span className="mt-1 text-xs leading-5 text-ink-muted">.xlsx 파일만 지원 · 가져오기 전 파일 형식을 검증합니다</span>
                <input type="file" name="file" accept=".xlsx" required className="mt-4 max-w-full text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-weak file:px-3 file:py-2 file:font-semibold file:text-brand" />
              </label>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Icon name="shield" className="h-3.5 w-3.5 text-done" />파일 구조를 확인한 뒤 업로드합니다.</p>
                <button className="btn btn-primary"><Icon name="upload" className="h-4 w-4" />검증 후 가져오기</button>
              </div>
            </form>
          ) : (
            <div className="panel-soft flex min-h-32 items-center gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pending-weak text-pending"><Icon name="shield" /></span>
              <div><p className="text-sm font-semibold text-ink">가져오기 권한이 없습니다</p><p className="mt-1 text-xs leading-5 text-ink-muted">프로젝트의 PMO 관리자에게 WBS 업데이트를 요청하세요.</p></div>
            </div>
          )}
        </div>
      </section>

      <section className="card p-5" aria-labelledby="baseline-title">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted"><Icon name="calendar" /></span>
          <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h3 id="baseline-title" className="text-sm font-semibold text-ink">일정 기준 및 공휴일</h3><span className="badge bg-pending-weak text-pending">준비 중</span></div><p className="mt-1 text-xs leading-5 text-ink-muted">간트 차트에 적용되는 비근무일과 프로젝트 기준 일정을 관리합니다.</p></div>
        </div>
      </section>
    </div>
  )
}
