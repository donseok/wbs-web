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
    <div className="space-y-4">
      <h1 className="text-lg font-bold">프로젝트</h1>
      <ul className="divide-y">
        {projects.map(p => (
          <li key={p.id} className="py-2">
            <Link className="text-blue-600" href={`/p/${p.id}/wbs`}>{p.name}</Link>
          </li>
        ))}
      </ul>
      {m?.role === 'pmo_admin' && (
        <form action={add} className="flex gap-2">
          <input name="name" placeholder="프로젝트명" className="border p-1" required />
          <input name="start" type="date" className="border p-1" />
          <input name="end" type="date" className="border p-1" />
          <button className="bg-black px-3 text-white">생성</button>
        </form>
      )}
    </div>
  )
}
