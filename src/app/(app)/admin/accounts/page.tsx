import { redirect } from 'next/navigation'
import { ShieldCheck, Users, UserCog, Eye } from 'lucide-react'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
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
  // 계정 관리는 슈퍼유저 전용(2026-08-20 결정 — 종전 설계 D7 '관리자 이상'을 대체).
  // getActorForView 는 권한 조회 실패를 null 로 열화한다 — 비로그인과 구분되지 않으므로
  // /projects 로 보낸다(그 화면은 권한 없이도 뜬다). /login 으로 보내면 로그인된 사용자가 튕겨 돈다.
  const actor = await getActorForView()
  if (!actor) redirect('/projects')
  if (!actor.isSuperuser) redirect('/projects')

  const [{ project }, projects] = await Promise.all([searchParams, listProjects()])
  const projectRows = projects as { id: string; name: string }[]
  // 기본 프로젝트는 **내가 관리자인 것** 중에서 고른다. 목록의 첫 항목으로 정하면
  // B 프로젝트 관리자가 들어왔을 때 A 가 기본값이 되어 게이트에 거부당하고,
  // 화면은 그 거부를 '계정 0개'로 보여준다(권한 화면이 곧 오정보가 된다).
  const managed = projectRows.filter(p => isProjectAdmin(actor, p.id))
  const projectId = managed.some(p => p.id === project) ? project! : managed[0]?.id
  if (!projectId) redirect('/projects') // 관리할 프로젝트가 없으면 역할을 부여할 대상이 없다

  const res = await listAccounts(projectId)
  if (!res.ok) {
    // 조용한 빈 화면 금지 — 원인을 그대로 보여준다(표시 = 로깅).
    return (
      <div className="space-y-6">
        <PageHero eyebrow="ADMIN" badge={<HeroBadge>Accounts</HeroBadge>} title="계정 관리"
          description="로그인 계정을 만들고 팀·프로젝트 역할을 지정하거나 비밀번호를 리셋합니다." />
        <div className="card p-6">
          <p className="text-sm font-semibold text-delayed">계정 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{res.error}</p>
        </div>
      </div>
    )
  }
  const accounts = res.rows
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
        projects={managed.map(p => ({ id: p.id, name: p.name }))}
        canManageAdmins={actor.isSuperuser}
      />
    </div>
  )
}
