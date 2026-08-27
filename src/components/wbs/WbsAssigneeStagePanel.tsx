'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  getWbsAssigneeStage, setWbsAssignee, setWbsAssigneeCascade, setWbsStage, setWbsDevWorkflow,
} from '@/app/actions/wbsAssign'
import { WbsSpecPanel } from './WbsSpecPanel'
import { AssigneeComboBox } from './AssigneeComboBox'
import type { DictKey } from '@/lib/i18n/dict'

type Stage = 'as' | 'fp' | 'ip' | 'im' | 'xx'
const STAGE_KEYS: Record<Stage, DictKey> = {
  as: 'wbs.stageAs', fp: 'wbs.stageFp',
  ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}
const STAGES: Stage[] = ['as', 'fp', 'ip', 'im', 'xx']

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
  itemId, members, editable, hasChildren = false,
}: {
  itemId: string
  members: ProjectMember[]
  editable: boolean
  /** 하위 항목이 있으면 "미지정 하위 항목에도 적용" 체크박스를 노출한다(스테이징 피드백). */
  hasChildren?: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const teamCodes = useTeamCodes()
  const assigneeLabelId = useId()
  const [loaded, setLoaded] = useState<{ assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean } | 'error' | null>(null)
  const [busy, setBusy] = useState<'assignee' | 'stage' | 'devWorkflow' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cascade, setCascade] = useState(true)
  const [cascadeResult, setCascadeResult] = useState<number | null>(null)
  const [cascadeWarn, setCascadeWarn] = useState(false)
  const [devCascade, setDevCascade] = useState(true)
  const [devWorkflowResult, setDevWorkflowResult] = useState<number | null>(null)
  const [devWorkflowWarn, setDevWorkflowWarn] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setErr(null)
    getWbsAssigneeStage(itemId).then(r => { if (alive) setLoaded(r ?? 'error') })
    return () => { alive = false }
  }, [itemId])

  async function onAssigneeChange(memberId: string | null) {
    setBusy('assignee'); setErr(null); setCascadeResult(null); setCascadeWarn(false)
    const useCascade = hasChildren && cascade && memberId !== null
    const res = useCascade
      ? await setWbsAssigneeCascade(itemId, memberId)
      : await setWbsAssignee(itemId, memberId)
    setBusy(null)
    if (!res.ok) { setErr(res.error ?? (useCascade ? t('wbs.assigneeCascadeFail') : t('wbs.errGeneric'))); return }
    // 배정 성공은 서버가 stage 도 함께 바꿀 수 있다(배정↔as 자동 전이) — 부분 낙관 갱신 대신
    // 전체 재조회로 loaded 를 교체한다(F2, 최종 리뷰). 재조회 실패는 기존 로딩 관례대로 'error'.
    const refreshed = await getWbsAssigneeStage(itemId)
    setLoaded(refreshed ?? 'error')
    if (useCascade && 'count' in res && typeof res.count === 'number' && res.count > 0) setCascadeResult(res.count)
    // 하위 UPDATE 만 실패한 부분 성공(리뷰 라운드 2) — 본인 반영은 확정됐으므로 성공 취급하되
    // "하위 일괄 적용은 실패했다"는 사실은 별도 경고로 알린다(assigneeCascadeFail 키 재사용).
    if (useCascade && 'cascadeFailed' in res && res.cascadeFailed) setCascadeWarn(true)
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

  async function onDevWorkflowChange(enabled: boolean) {
    setBusy('devWorkflow'); setErr(null); setDevWorkflowResult(null); setDevWorkflowWarn(false)
    const useCascade = hasChildren && devCascade
    const res = await setWbsDevWorkflow(itemId, enabled, useCascade)
    setBusy(null)
    if (!res.ok) { setErr(res.error ?? t('wbs.errGeneric')); return }
    // OFF 는 ready 주문 취소를 동반하는 서버 동작(브리프) — 확인 모달 없이 즉시 실행하고
    // 결과 문구로만 알린다(브라우저 confirm() 은 자동화를 막아 세션 규칙상 금지).
    // ON 은 배정↔as 자동 전이·자동 발행을 동반할 수 있다 — 부분 낙관 갱신 대신 전체 재조회(F2, 최종 리뷰).
    const refreshed = await getWbsAssigneeStage(itemId)
    setLoaded(refreshed ?? 'error')
    if (typeof res.count === 'number' && res.count > 0) setDevWorkflowResult(res.count)
    if (res.cascadeFailed) setDevWorkflowWarn(true)
    router.refresh()
  }

  const memberName = (id: string | null) => id ? members.find(m => m.id === id)?.name ?? id : null

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface-2/40 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          <User className="h-3.5 w-3.5" /> {t('wbs.assigneeStagePanelTitle')}
        </div>

        <div className="mt-2 space-y-2">
          {loaded === null ? (
            <p className="text-xs text-ink-subtle">{t('common.loading')}</p>
          ) : loaded === 'error' ? (
            <p className="text-xs font-medium text-delayed">{t('wbs.assigneeStageLoadFail')}</p>
          ) : (
            <>
              {/* 담당·단계를 2열 한 행으로(2026-08-28). 종전엔 라벨+컨트롤이 세로로 6줄 쌓여
                  이 섹션만으로 패널 한 화면을 먹었다. 전파 체크는 각자 소속 컨트롤 바로 아래 둔다 —
                  한 줄로 몰면 무엇에 걸리는 전파인지 화면에서 사라진다. */}
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                <div>
                  {/* <label> 아님 — 안의 콤보박스가 role=listbox/option 을 갖는 상호작용 콘텐츠라
                      <label> 로 감싸면 옵션 클릭이 label 활성화(입력 재포커스)와 충돌한다.
                      aria-labelledby 로만 라벨을 연결한다. */}
                  <span id={assigneeLabelId} className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.assigneeLabel')}</span>
                  {editable ? (
                    <AssigneeComboBox
                      members={members}
                      value={loaded.assigneeMemberId}
                      disabled={busy === 'assignee'}
                      onChange={onAssigneeChange}
                      categoryOrder={teamCodes}
                      unassignedLabel={t('wbs.assigneeUnassignedOption')}
                      placeholder={t('wbs.assigneeSearchPlaceholder')}
                      noResultsLabel={t('wbs.assigneeSearchNoResults')}
                      ariaLabelledBy={assigneeLabelId}
                    />
                  ) : (
                    <p className="text-[13px] text-ink">{memberName(loaded.assigneeMemberId) ?? t('wbs.assigneeUnassignedOption')}</p>
                  )}
                  {editable && hasChildren && (
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-line"
                        checked={cascade}
                        onChange={e => setCascade(e.target.checked)}
                        disabled={busy === 'assignee'}
                      />
                      {t('wbs.assigneeCascadeLabel')}
                    </label>
                  )}
                </div>

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
                    <p className="text-[13px] text-ink">
                      {loaded.stage && STAGE_KEYS[loaded.stage as Stage] ? t(STAGE_KEYS[loaded.stage as Stage]) : t('wbs.stageNoneOption')}
                    </p>
                  )}
                </label>
              </div>

              {/* dev_workflow — NULL 진입점 토글. editable=false 에서도 현재값을 disabled
                  체크박스로 보여준다(브리프). OFF 는 ready 주문 취소를 동반하는 서버 동작이라
                  confirm() 없이 즉시 실행하고 결과 문구로 알린다(브라우저 모달 금지). */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-line"
                    checked={loaded.devWorkflow}
                    onChange={e => onDevWorkflowChange(e.target.checked)}
                    disabled={!editable || busy === 'devWorkflow'}
                  />
                  {t('wbs.devWorkflowLabel')}
                </label>
                {editable && hasChildren && (
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-line"
                      checked={devCascade}
                      onChange={e => setDevCascade(e.target.checked)}
                      disabled={busy === 'devWorkflow'}
                    />
                    {t('wbs.devWorkflowCascadeLabel')}
                  </label>
                )}
              </div>

              {/* 결과·경고는 있을 때만 자리를 차지한다 */}
              {cascadeResult !== null && (
                <p className="text-[11px] font-medium text-brand">
                  {t('wbs.assigneeCascadeResult').replace('{n}', String(cascadeResult))}
                </p>
              )}
              {cascadeWarn && (
                <p className="text-[11px] font-medium text-delayed" role="alert">{t('wbs.assigneeCascadeFail')}</p>
              )}
              {devWorkflowResult !== null && (
                <p className="text-[11px] font-medium text-brand">
                  {t('wbs.devWorkflowResult').replace('{n}', String(devWorkflowResult))}
                </p>
              )}
              {devWorkflowWarn && (
                <p className="text-[11px] font-medium text-delayed" role="alert">{t('wbs.devWorkflowFail')}</p>
              )}

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
