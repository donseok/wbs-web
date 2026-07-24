import { redirect } from 'next/navigation'
import { Landmark, ListChecks, Users } from 'lucide-react'
import { getMembership } from '@/lib/auth'
import { listTeamsAdmin } from '@/app/actions/teams'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { TeamsManager } from '@/components/admin/TeamsManager'

export const dynamic = 'force-dynamic' // 기준정보는 항상 최신 조회(관리 직후 반영)

export default async function TeamsAdminPage() {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') redirect('/projects')

  const teams = await listTeamsAdmin()
  const active = teams.filter(t => t.active).length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Teams</HeroBadge>}
        title="팀 관리"
        description="담당 팀 기준정보를 관리합니다 — 탭·필터·검증·엑셀·회의록 편철이 모두 이 목록을 따릅니다."
        heroKpis={
          <>
            <KpiCard variant="hero" label="TEAMS" value={teams.length} sub="전체 팀" icon={Users} tone="brand" />
            <KpiCard variant="hero" label="ACTIVE" value={active} sub="활성(화면 노출)" icon={ListChecks} tone="success" />
            <KpiCard variant="hero" label="HIDDEN" value={teams.length - active} sub="비활성(데이터 보존)" icon={Landmark} tone="default" />
          </>
        }
      />
      <TeamsManager teams={teams} />
    </div>
  )
}
