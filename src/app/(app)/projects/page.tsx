import Link from 'next/link'
import { listProjects, createProject } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'
import { Icon } from '@/components/ui/Icon'

export default async function Projects() {
  const [projects, membership] = await Promise.all([listProjects(), getMembership()])
  async function add(formData: FormData) {
    'use server'
    await createProject(String(formData.get('name')), String(formData.get('start')) || null, String(formData.get('end')) || null)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Workspace overview</div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.025em] text-ink">프로젝트</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-ink-muted">진행 현황을 확인하고 WBS, 일정, 리스크를 한곳에서 관리하세요.</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-muted shadow-sm">
          <span className="h-2 w-2 rounded-full bg-done" /> 운영 중
          <strong className="tabular-nums text-ink">{projects.length}</strong>
        </div>
      </header>

      <div className={`grid gap-5 ${membership?.role === 'pmo_admin' ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
        <section aria-labelledby="project-list-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="project-list-title" className="text-sm font-semibold text-ink">전체 프로젝트</h2>
            <span className="text-xs text-ink-subtle">최근 생성 순</span>
          </div>
          {projects.length === 0 ? (
            <div className="card flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-weak text-brand"><Icon name="folder" /></span>
              <h3 className="mt-4 text-base font-semibold text-ink">첫 프로젝트를 만들어 보세요</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-ink-muted">프로젝트를 만들고 WBS 엑셀을 가져오면 계획과 실적 추적을 바로 시작할 수 있습니다.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {projects.map((project, index) => (
                <li key={project.id}>
                  <Link href={`/p/${project.id}/wbs`} className="card group flex min-h-48 flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-[0_16px_40px_rgb(15_23_42/0.09)]">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#6d82ff] text-xs font-bold text-white shadow-[0_8px_22px_rgb(51_92_255/0.22)]">
                        {project.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-subtle transition group-hover:border-brand-ring group-hover:bg-brand-weak group-hover:text-brand"><Icon name="arrow" className="h-4 w-4" /></span>
                    </div>
                    <div className="mt-5">
                      <h3 className="truncate text-[15px] font-semibold text-ink">{project.name}</h3>
                      <div className="mt-2 flex items-center gap-2 text-xs text-ink-subtle">
                        <Icon name="calendar" className="h-3.5 w-3.5" />
                        <span>{project.start_date || project.end_date ? `${project.start_date ?? '미정'} — ${project.end_date ?? '미정'}` : '일정 미설정'}</span>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-line pt-4 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium text-done"><span className="h-1.5 w-1.5 rounded-full bg-done" />Active</span>
                      <span className="text-ink-subtle">Project {String(index + 1).padStart(2, '0')}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {membership?.role === 'pmo_admin' && (
          <aside className="xl:sticky xl:top-24 xl:self-start">
            <form action={add} className="card overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-5 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-weak text-brand"><Icon name="plus" className="h-4 w-4" /></span>새 프로젝트</div>
                <p className="mt-2 text-xs leading-5 text-ink-muted">기본 정보를 입력한 뒤 WBS를 가져올 수 있습니다.</p>
              </div>
              <div className="space-y-4 p-5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">프로젝트명</span>
                  <input name="name" placeholder="예: ERP 고도화 프로젝트" className="app-input" required />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">시작일</span><input name="start" type="date" className="app-input px-2 text-xs" /></label>
                  <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">종료일</span><input name="end" type="date" className="app-input px-2 text-xs" /></label>
                </div>
                <button className="btn btn-primary w-full"><Icon name="plus" className="h-4 w-4" />프로젝트 생성</button>
              </div>
            </form>
          </aside>
        )}
      </div>
    </div>
  )
}
