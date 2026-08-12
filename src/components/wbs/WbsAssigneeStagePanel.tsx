'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { MemberSelectOptions } from '@/components/members/MemberPicker'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { getWbsAssigneeStage, setWbsAssignee, setWbsStage } from '@/app/actions/wbsAssign'
import { WbsSpecPanel } from './WbsSpecPanel'
import type { DictKey } from '@/lib/i18n/dict'

type Stage = 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx'
const STAGE_KEYS: Record<Stage, DictKey> = {
  todo: 'wbs.stageTodo', as: 'wbs.stageAs', fp: 'wbs.stageFp',
  ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}
const STAGES: Stage[] = ['todo', 'as', 'fp', 'ip', 'im', 'xx']

/**
 * 선택된 WBS 항목의 담당자(로스터 축)·단계 편집 — §2.5.
 *
 * RowDetailPanel 내부 섹션으로 임베드된다(리뷰 라운드 1 — 별도 fixed 오버레이가
 * RowDetailPanel(aria-modal) 뒤에 숨어 키보드·스크린리더로 도달 불가했다. 하나의
 * 항목에 dialog 하나만 뜨도록 이 컴포넌트는 더는 자체 오버레이/닫기 버튼을 갖지 않고
 * 호출부(RowDetailPanel)가 배치를 맡는다).
 *
 * ComputedItem 을 확장하지 않고 RowDetailPanel의 getChangeLogs 관례처럼 선택 변경 시
 * 클라이언트에서 별도 로드한다. 편집은 프로젝트 관리자만(editable=false 면 읽기 전용).
 */
export function WbsAssigneeStagePanel({
  itemId, members, editable,
}: {
  itemId: string
  members: ProjectMember[]
  editable: boolean
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
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface-2/40 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <User className="h-3.5 w-3.5" /> {t('wbs.assigneeStagePanelTitle')}
        </div>

        <div className="mt-2 space-y-3">
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
      </section>

      {/* 명세(Task 12A, 결정 B) — 이 패널의 섹션으로 편입, 별도 오버레이 아님(리뷰 라운드 1 관례). */}
      <WbsSpecPanel itemId={itemId} editable={editable} />
    </div>
  )
}
