'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { MemberSelectOptions } from '@/components/members/MemberPicker'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { getWbsAssigneeStage, setWbsAssignee, setWbsStage } from '@/app/actions/wbsAssign'
import type { DictKey } from '@/lib/i18n/dict'

type Stage = 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx'
const STAGE_KEYS: Record<Stage, DictKey> = {
  todo: 'wbs.stageTodo', as: 'wbs.stageAs', fp: 'wbs.stageFp',
  ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}
const STAGES: Stage[] = ['todo', 'as', 'fp', 'ip', 'im', 'xx']

/**
 * 선택된 WBS 항목의 담당자(로스터 축)·단계 편집 — §2.5. ComputedItem 을 확장하지 않고
 * RowDetailPanel의 getChangeLogs 관례처럼 선택 변경 시 클라이언트에서 별도 로드한다.
 * 편집은 프로젝트 관리자만(editable=false 면 읽기 전용으로 렌더).
 */
export function WbsAssigneeStagePanel({
  itemId, itemName, members, editable, onClose,
}: {
  itemId: string
  itemName: string
  members: ProjectMember[]
  editable: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const { t } = useLocale()
  const teamCodes = useTeamCodes()
  const [loaded, setLoaded] = useState<{ assigneeMemberId: string | null; stage: string | null } | 'error' | null>(null)
  const [busy, setBusy] = useState<'assignee' | 'stage' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setErr(null)
    getWbsAssigneeStage(itemId).then(r => { if (alive) setLoaded(r ?? 'error') })
    return () => { alive = false }
  }, [itemId])

  async function onAssigneeChange(memberId: string | null) {
    setBusy('assignee'); setErr(null)
    const res = await setWbsAssignee(itemId, memberId)
    setBusy(null)
    if (!res.ok) { setErr(res.error ?? t('wbs.errGeneric')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, assigneeMemberId: memberId } : prev))
    router.refresh()
  }

  async function onStageChange(stage: Stage | null) {
    setBusy('stage'); setErr(null)
    const res = await setWbsStage(itemId, stage)
    setBusy(null)
    if (!res.ok) { setErr(res.error ?? t('wbs.errGeneric')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage } : prev))
    router.refresh()
  }

  const memberName = (id: string | null) => id ? members.find(m => m.id === id)?.name ?? id : null

  return (
    <aside
      className="fixed bottom-6 left-6 z-[120] w-72 rounded-2xl border border-line bg-surface shadow-[var(--shadow-xl)]"
      role="dialog"
      aria-label={`${itemName} · ${t('wbs.assigneeStagePanelTitle')}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            {t('wbs.assigneeStagePanelTitle')}
          </div>
          <div className="truncate text-[13px] font-semibold text-ink" title={itemName}>{itemName}</div>
        </div>
        <button
          onClick={onClose}
          aria-label={t('wbs.assigneeStageClose')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {loaded === null ? (
          <p className="text-xs text-ink-subtle">{t('common.loading')}</p>
        ) : loaded === 'error' ? (
          <p className="text-xs font-medium text-delayed">{t('wbs.assigneeStageLoadFail')}</p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.assigneeLabel')}</span>
              {editable ? (
                <select
                  value={loaded.assigneeMemberId ?? ''}
                  disabled={busy === 'assignee'}
                  onChange={e => onAssigneeChange(e.target.value || null)}
                  className="app-input h-9 text-xs"
                >
                  <option value="">{t('wbs.assigneeUnassignedOption')}</option>
                  <MemberSelectOptions members={members} view="name" categoryOrder={teamCodes} />
                </select>
              ) : (
                <p className="text-sm text-ink">{memberName(loaded.assigneeMemberId) ?? t('wbs.assigneeUnassignedOption')}</p>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.stageLabel')}</span>
              {editable ? (
                <select
                  value={loaded.stage ?? ''}
                  disabled={busy === 'stage'}
                  onChange={e => onStageChange((e.target.value || null) as Stage | null)}
                  className="app-input h-9 text-xs"
                >
                  <option value="">{t('wbs.stageNoneOption')}</option>
                  {STAGES.map(s => <option key={s} value={s}>{t(STAGE_KEYS[s])}</option>)}
                </select>
              ) : (
                <p className="text-sm text-ink">
                  {loaded.stage && STAGE_KEYS[loaded.stage as Stage] ? t(STAGE_KEYS[loaded.stage as Stage]) : t('wbs.stageNoneOption')}
                </p>
              )}
            </label>

            {!editable && <p className="text-[11px] text-ink-subtle">{t('wbs.assigneeStageReadOnly')}</p>}
            {err && <p className="text-xs font-medium text-delayed" role="alert">{err}</p>}
          </>
        )}
      </div>
    </aside>
  )
}
