'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, PauseCircle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { setAgentProjectEnabled } from '@/app/actions/agentWork'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 에이전트 킬스위치(2026-08-24). 활성은 위임 체크가 자동으로 하므로 여기서 사람이 하는 건 "중지"와
 * "재개"뿐. 재개하면 백필로 dev_workflow 리프 전부에 주문이 보장된다.
 */
export function AgentProjectToggle({ projectId, registered, enabled }: {
  projectId: string; registered: boolean; enabled: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [pending, start] = useTransition()

  const toggle = () => start(async () => {
    try {
      const res = await setAgentProjectEnabled(projectId, !enabled)
      if (!res.ok) { toast({ title: res.error ?? t('settings.actionFailed'), variant: 'error' }); return }
      router.refresh()
      toast({
        title: enabled ? t('settings.agentStopped') : t('settings.agentResumed'),
        description: !enabled && res.backfilled ? `${t('settings.agentBackfilled')} ${res.backfilled}` : undefined,
        variant: 'success',
      })
    } catch {
      toast({ title: t('settings.actionError'), variant: 'error' })
    }
  })

  const chip = !registered
    ? { cls: 'bg-surface-2 text-ink-subtle', label: t('settings.agentChipIdle') }
    : enabled
      ? { cls: 'bg-brand-weak text-brand', label: t('settings.agentChipOn') }
      : { cls: 'bg-pending-weak text-accent-warning', label: t('settings.agentChipStopped') }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`chip ${chip.cls}`}>
        {enabled ? <Bot className="mr-1 h-3.5 w-3.5" aria-hidden /> : <PauseCircle className="mr-1 h-3.5 w-3.5" aria-hidden />}
        {chip.label}
      </span>
      <button disabled={pending} onClick={toggle} className="btn btn-ghost h-9 px-3 text-[13px]">
        {enabled ? t('settings.agentStop') : t('settings.agentResume')}
      </button>
    </div>
  )
}
