import { Users, ShieldCheck, UserRound } from 'lucide-react'
import { getProjectMembers } from '@/lib/data/members'
import { getMembership } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { MembersBoard } from '@/components/members/MembersBoard'

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [members, m, projects] = await Promise.all([
    getProjectMembers(projectId),
    getMembership(),
    listProjects(),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? '프로젝트'
  const canEdit = m?.role === 'pmo_admin'

  const teamSize = members.length
  const admins = members.filter((x) => x.role === 'admin').length
  const contributors = members.filter((x) => x.role === 'contributor').length

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="TEAM"
        badge={<HeroBadge>Members</HeroBadge>}
        title={`${projectName} 팀 구성`}
        description="참여자를 역할과 소속이 명확한 팀 보드로 정리했습니다."
        aside={
          <>
            <KpiCard label="TEAM SIZE" value={teamSize} sub="전체 참여자" icon={Users} tone="brand" />
            <KpiCard label="ADMINS" value={admins} sub="프로젝트 관리자" icon={ShieldCheck} tone="success" />
            <KpiCard label="CONTRIBUTORS" value={contributors} sub="실무 기여자" icon={UserRound} tone="default" />
          </>
        }
      />

      <MembersBoard members={members} canEdit={canEdit} projectId={projectId} />
    </div>
  )
}
