import { Users } from 'lucide-react'
import { SectionCard } from '@/components/ui/SectionCard'
import type { UsageUserRow } from '@/lib/domain/usage'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(iso))
}

const ROLE_LABEL: Record<string, string> = { pmo_admin: '관리자', team_editor: '팀 편집자' }

/**
 * 사용자 현황 — 계정 기준이라 활동이 0인 휴면 계정도 표시된다.
 * last_sign_in_at 은 수집 시작 이전까지 소급되므로 배포 첫날부터 채워진다.
 */
export function UsageUserTable({ rows, days }: { rows: UsageUserRow[]; days: number }) {
  return (
    <SectionCard eyebrow="USERS" title="사용자 현황" icon={Users}
      actions={<span className="badge bg-brand-weak text-brand">{rows.length}명</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              <th className="py-2 pr-3 text-left">이름</th>
              <th className="py-2 pr-3 text-left">이메일</th>
              <th className="py-2 pr-3 text-left">팀</th>
              <th className="py-2 pr-3 text-left">권한</th>
              <th className="py-2 pr-3 text-left">가입일</th>
              <th className="py-2 pr-3 text-left">마지막 로그인</th>
              <th className="py-2 pr-3 text-left">최근 활동</th>
              <th className="py-2 pr-3 text-right">{days}일 조회</th>
              <th className="py-2 pr-3 text-right">방문일수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.email}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.teamCode ?? '—'}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.role ? (ROLE_LABEL[r.role] ?? r.role) : '—'}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.createdAt)}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.lastSignInAt)}</td>
                <td className="py-2 pr-3 tabular-nums text-ink-muted">{fmtDate(r.lastActivityAt)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{r.events.toLocaleString('ko-KR')}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink">{r.activeDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
