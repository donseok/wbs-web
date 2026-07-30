import { redirect } from 'next/navigation'
import { ShieldCheck, Users, UserCog, Eye } from 'lucide-react'
import { getActor } from '@/lib/authz'
import { isAnyProjectAdmin } from '@/lib/domain/authz'
import { listAccounts } from '@/app/actions/accounts'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AccountsManager } from '@/components/admin/AccountsManager'

export const dynamic = 'force-dynamic' // 목록은 항상 최신(admin API) 조회

export default async function AccountsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  // 관리자도 계정을 만들 수 있다(설계 D7) — 슈퍼유저 전용이 아니다.
  const actor = await getActor()
  if (!actor) redirect('/login')
  if (!isAnyProjectAdmin(actor)) redirect('/projects')

  const [{ project }, projects] = await Promise.all([searchParams, listProjects()])
  const projectRows = projects as { id: string; name: string }[]
  const projectId = projectRows.some(p => p.id === project) ? project! : projectRows[0]?.id
  if (!projectId) redirect('/projects') // 프로젝트가 없으면 역할을 부여할 대상이 없다

  const accounts = await listAccounts(projectId)
  const total = accounts.length
  const superusers = accounts.filter((a) => a.isSuperuser).length
  const admins = accounts.filter((a) => a.role === 'admin').length
  const members = accounts.filter((a) => a.role === 'member').length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Accounts</HeroBadge>}
        title="계정 관리"
        description="로그인 계정을 만들고 팀·프로젝트 역할을 지정하거나 비밀번호를 리셋합니다."
        heroKpis={
          <>
            <KpiCard variant="hero" label="ACCOUNTS" value={total} sub="전체 로그인 계정" icon={Users} tone="brand" />
            <KpiCard variant="hero" label="SUPERUSER" value={superusers} sub="슈퍼유저" icon={ShieldCheck} tone="success" />
            <KpiCard variant="hero" label="ADMIN / MEMBER" value={`${admins} / ${members}`} sub="관리자 / 멤버" icon={UserCog} tone="default" />
            <KpiCard variant="hero" label="VIEWER" value={total - admins - members} sub="조회 전용" icon={Eye} tone="default" />
          </>
        }
      />
      <AccountsManager
        accounts={accounts}
        projectId={projectId}
        projects={projectRows.map(p => ({ id: p.id, name: p.name }))}
        canManageAdmins={actor.isSuperuser}
      />
    </div>
  )
}
