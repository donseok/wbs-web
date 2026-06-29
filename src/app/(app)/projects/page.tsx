import Link from 'next/link'
import { listProjects, createProject } from '@/app/actions/project'
import { getMembership } from '@/lib/auth'

export default async function Projects() {
  const [projects, m] = await Promise.all([listProjects(), getMembership()])
  async function add(formData: FormData) {
    'use server'
    await createProject(String(formData.get('name')), String(formData.get('start')) || null, String(formData.get('end')) || null)
  }
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">프로젝트</h1>
          <p className="mt-1 text-sm text-ink-muted">진행 중인 프로젝트의 WBS와 대시보드를 관리합니다.</p>
        </div>
        <span className="text-sm text-ink-subtle">{projects.length}개</span>
      </div>

      {projects.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">아직 프로젝트가 없습니다</p>
          <p className="text-sm text-ink-muted">아래에서 새 프로젝트를 생성하세요.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(p => (
            <li key={p.id}>
              <Link
                href={`/p/${p.id}/wbs`}
                className="card group flex h-full flex-col gap-3 p-4 transition hover:border-brand-ring hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-weak text-sm font-semibold text-brand">
                    {p.name.slice(0, 2)}
                  </span>
                  <span className="text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-brand">→</span>
                </div>
                <div className="font-medium text-ink">{p.name}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {m?.role === 'pmo_admin' && (
        <form action={add} className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-ink">새 프로젝트 생성</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 min-w-[200px] flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">프로젝트명</span>
              <input name="name" placeholder="프로젝트명" className="app-input" required />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">시작일</span>
              <input name="start" type="date" className="app-input w-auto" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">종료일</span>
              <input name="end" type="date" className="app-input w-auto" />
            </label>
            <button className="btn btn-primary">생성</button>
          </div>
        </form>
      )}
    </div>
  )
}
