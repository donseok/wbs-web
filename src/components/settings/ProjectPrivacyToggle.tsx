'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Lock } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { setProjectPrivacy } from '@/app/actions/project'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 공개 범위 토글 — 렌더 자체가 슈퍼유저 전용(페이지에서 게이팅), 액션도 requireSuperuser 로 재검증. */
export function ProjectPrivacyToggle({ projectId, isPrivate }: { projectId: string; isPrivate: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [pending, start] = useTransition()

  const toggle = () => start(async () => {
    try {
      const res = await setProjectPrivacy(projectId, !isPrivate)
      if (!res.ok) {
        toast({ title: res.error ?? t('settings.actionFailed'), variant: 'error' })
        return
      }
      router.refresh()
      toast({ title: t('settings.privacyApplied'), variant: 'success' })
    } catch {
      toast({ title: t('settings.actionError'), variant: 'error' })
    }
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`chip ${isPrivate ? 'bg-pending-weak text-accent-warning' : 'bg-brand-weak text-brand'}`}>
        {isPrivate
          ? <><Lock className="mr-1 h-3.5 w-3.5" aria-hidden />{t('settings.privacyPrivateChip')}</>
          : <><Globe className="mr-1 h-3.5 w-3.5" aria-hidden />{t('settings.privacyPublicChip')}</>}
      </span>
      <button disabled={pending} onClick={toggle} className="btn btn-ghost h-9 px-3 text-[13px]">
        {isPrivate ? t('settings.privacyToPublic') : t('settings.privacyToPrivate')}
      </button>
    </div>
  )
}
