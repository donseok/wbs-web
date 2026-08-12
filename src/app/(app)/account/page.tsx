import { getSession } from '@/lib/auth'
import { displayNameFrom } from '@/lib/domain/display-name'
import { listProjectsWithState } from '@/app/actions/project'
import { AccountView } from '@/components/account/AccountView'

export const dynamic = 'force-dynamic'

/**
 * 내 계정 — 프로필·비밀번호 변경·PAT 발급/관리(결정 D). 비로그인은 middleware 가 /login 으로
 * 리다이렉트하므로 여기서 별도 가드는 두지 않는다((app) 레이아웃 관례).
 */
export default async function AccountPage() {
  const [user, projectState] = await Promise.all([getSession(), listProjectsWithState()])
  const email = user?.email ?? null
  const displayName = user ? displayNameFrom(user.user_metadata, user.email) : null

  return (
    <AccountView
      email={email}
      displayName={displayName}
      projects={projectState.projects.map(p => ({ id: p.id, name: p.name }))}
    />
  )
}
