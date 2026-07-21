import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getMembership } from '@/lib/auth'
import { getLlmConfig } from '@/app/actions/llmConfig'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { LlmConfigManager } from '@/components/admin/LlmConfigManager'

export const dynamic = 'force-dynamic' // 설정·프로필은 항상 최신 DB 값을 읽는다

export default async function LlmConfigAdminPage() {
  const m = await getMembership()
  if (m?.role !== 'pmo_admin') redirect('/projects')

  const res = await getLlmConfig()

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="ADMIN"
        badge={<HeroBadge>LLM</HeroBadge>}
        title="LLM 설정"
        description="서버가 사용할 LLM을 프로필로 등록해 두고 재배포 없이 전환합니다."
      />
      {'error' in res ? (
        // 조회 실패를 빈 화면으로 삼키면 '선택 안함'으로 저장된 서버가 env 로 보이는 등
        // 관리자가 잘못된 상태를 사실로 착각한다 — 원인을 그대로 드러낸다.
        <div className="card flex items-start gap-3 p-5 sm:p-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-delayed-weak text-delayed">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">LLM 설정을 불러오지 못했습니다</h2>
            <p role="alert" className="mt-1 break-words text-sm leading-6 text-ink-muted">{res.error}</p>
            <p className="mt-1 text-xs text-ink-subtle">마이그레이션(0038) 적용 여부와 권한을 확인한 뒤 새로고침하세요.</p>
          </div>
        </div>
      ) : (
        <LlmConfigManager initial={res} />
      )}
    </div>
  )
}
