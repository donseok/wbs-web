'use client'
// 항목 큐레이션 버튼 — AI가 정리한 지식을 사람이 닫고·확정하고·숨기는 유일한 UI.
// 문장 수정은 제공하지 않는다. 원문 근거와 어긋나는 문장을 사람이 덮어쓰면 Wiki의
// "모든 지식은 회의록 블록으로 추적된다"는 계약이 깨지기 때문이다(잘못 뽑힌 항목은 숨김).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCheck, EyeOff, LockKeyhole, LockKeyholeOpen, RotateCcw, ShieldCheck,
} from 'lucide-react'
import type { DictKey, Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import { useToast } from '@/components/ui/Toast'
import { curateWikiItem, type WikiCurateAction } from '@/app/actions/wiki'
import {
  isArchivedWikiItem,
  isConflictedWikiItem,
  normalizedWikiState,
} from '@/lib/domain/wikiView'
import type { WikiItem } from '@/lib/data/wiki'

const OPEN_KINDS = new Set(['action', 'question', 'risk'])

interface ActionSpec {
  action: WikiCurateAction
  labelKey: DictKey
  icon: typeof CheckCheck
  /** 되돌리기 번거로운 동작만 확인을 받는다. */
  confirmKey?: DictKey
}

/** 현재 상태에서 의미 있는 동작만 노출한다. 불가능한 전이는 RPC가 다시 막는다. */
function availableActions(item: WikiItem): ActionSpec[] {
  if (isArchivedWikiItem(item)) {
    return [{ action: 'restore', labelKey: 'wiki.curate.restore', icon: RotateCcw }]
  }

  const specs: ActionSpec[] = []
  const lifecycle = normalizedWikiState(item.lifecycleState)

  if (OPEN_KINDS.has(item.kind) && lifecycle !== 'resolved') {
    specs.push({ action: 'resolve', labelKey: 'wiki.curate.resolve', icon: CheckCheck })
  }
  if (isConflictedWikiItem(item) || normalizedWikiState(item.certainty) === 'tentative') {
    specs.push({ action: 'confirm', labelKey: 'wiki.curate.confirm', icon: ShieldCheck })
  }
  specs.push(item.autoUpdateLocked
    ? { action: 'unlock', labelKey: 'wiki.curate.unlock', icon: LockKeyholeOpen }
    : { action: 'lock', labelKey: 'wiki.curate.lock', icon: LockKeyhole })
  specs.push({
    action: 'archive',
    labelKey: 'wiki.curate.archive',
    icon: EyeOff,
    confirmKey: 'wiki.curate.archiveConfirm',
  })
  return specs
}

export function WikiItemActions({
  item,
  projectId,
  locale,
}: {
  item: WikiItem
  projectId: string
  locale: Locale
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [running, setRunning] = useState<WikiCurateAction | null>(null)

  function run(spec: ActionSpec) {
    if (spec.confirmKey && !window.confirm(t(locale, spec.confirmKey))) return
    setRunning(spec.action)
    startTransition(async () => {
      const result = await curateWikiItem({
        projectId,
        topicId: item.topicId,
        itemId: item.id,
        action: spec.action,
      })
      setRunning(null)
      if (!result.ok) {
        toast({ title: result.error ?? t(locale, 'wiki.curate.failed'), variant: 'error' })
        return
      }
      toast({ title: t(locale, 'wiki.curate.done'), variant: 'success' })
      router.refresh()
    })
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/80 pt-3">
      {availableActions(item).map((spec) => {
        const Icon = spec.icon
        return (
          <button
            key={spec.action}
            type="button"
            disabled={pending}
            onClick={() => run(spec)}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className="h-3 w-3" aria-hidden />
            {running === spec.action ? t(locale, 'wiki.curate.running') : t(locale, spec.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
