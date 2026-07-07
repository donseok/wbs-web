import { redirect } from 'next/navigation'
import { ShieldCheck, Users, UserCog } from 'lucide-react'
import { getMembership } from '@/lib/auth'
import { listAccounts } from '@/app/actions/accounts'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AccountsManager } from '@/components/admin/AccountsManager'

export const dynamic = 'force-dynamic' // 목록은 항상 최신(admin API) 조회

export default async function AccountsAdminPage() {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') redirect('/projects')

  const accounts = await listAccounts()
  const total = accounts.length
  const admins = accounts.filter((a) => a.role === 'pmo_admin').length
  const editors = accounts.filter((a) => a.role === 'team_editor').length

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>Accounts</HeroBadge>}
        title="계정 관리"
        description="로그인 계정을 만들고 팀·권한을 지정하거나 비밀번호를 리셋합니다."
        heroKpis={
          <>
            <KpiCard variant="hero" label="ACCOUNTS" value={total} sub="전체 로그인 계정" icon={Users} tone="brand" />
            <KpiCard variant="hero" label="PMO ADMIN" value={admins} sub="관리자" icon={ShieldCheck} tone="success" />
            <KpiCard variant="hero" label="TEAM EDITOR" value={editors} sub="팀 편집자" icon={UserCog} tone="default" />
          </>
        }
      />
      <AccountsManager accounts={accounts} />
    </div>
  )
}
