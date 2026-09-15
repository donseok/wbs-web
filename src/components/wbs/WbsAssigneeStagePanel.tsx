'use client'

import { useEffect, useId, useRef, useState } from 'react'
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
import { useDebouncedSave } from './useDebouncedSave'
import { PendingSaveChip } from './PendingSaveChip'
import type { DictKey } from '@/lib/i18n/dict'
import { STAGE_CODES, type StageCode } from '@/lib/domain/stageLabels'

type Stage = StageCode
/** 서버 확정 값이자 debounce 저장 필드 — getWbsAssigneeStage 의 반환 형태 그대로다. */
type AssigneeStage = { assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean }
/** 담당·단계·dev workflow 액션 반환의 합집합. count·cascadeFailed 는 cascade 계열만 실어 온다. */
type AssigneeStageResult = { ok: boolean; error?: string; count?: number; cascadeFailed?: boolean; orderCreated?: boolean }
const STAGE_KEYS: Record<Stage, DictKey> = {
  as: 'wbs.stageAs', ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}
const STAGES: readonly Stage[] = STAGE_CODES

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
  const [loaded, setLoaded] = useState<AssigneeStage | 'error' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cascade, setCascade] = useState(true)
  const [cascadeResult, setCascadeResult] = useState<number | null>(null)
  const [cascadeWarn, setCascadeWarn] = useState(false)
  const [devCascade, setDevCascade] = useState(true)
  const [devWorkflowResult, setDevWorkflowResult] = useState<number | null>(null)
  const [devWorkflowWarn, setDevWorkflowWarn] = useState(false)
  // 전파 체크는 저장이 실제로 나가는 순간(flush)의 값을 쓴다 — 담당을 고른 뒤 5초 안에 전파 체크를
  // 바꿔도 반영되도록. commit 클로저는 set 시점에 잡히므로 ref 로 읽는다.
  const cascadeRef = useRef(cascade)
  const devCascadeRef = useRef(devCascade)
  useEffect(() => { cascadeRef.current = cascade }, [cascade])
  useEffect(() => { devCascadeRef.current = devCascade }, [devCascade])

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setErr(null)
    getWbsAssigneeStage(itemId).then(r => { if (alive) setLoaded(r ?? 'error') })
    return () => { alive = false }
  }, [itemId])

  // 담당 콤보박스·단계 select·dev workflow 체크박스는 debounce 저장(2026-09-14). 종전엔 변경 하나마다
  // 서버 액션 + router.refresh() 가 나가 WBS 페이지 전체가 다시 렌더됐다. 마지막 변경 뒤 SAVE_DEBOUNCE_MS
  // 가 지나면(또는 패널 닫힘·항목 변경·「지금 저장」) 모아서 순서대로 저장하고 refresh 는 1회만 부른다.
  // 화면은 quick.view 로 낙관 표시하고, 실패한 필드는 대기에서 빠져 loaded(서버 확정 값)로 돌아간다.
  const quick = useDebouncedSave<AssigneeStage, AssigneeStageResult>({
    scope: itemId,
    baseline: loaded && loaded !== 'error' ? loaded : null,
    commit: {
      assigneeMemberId: memberId => (hasChildren && cascadeRef.current && memberId !== null)
        ? setWbsAssigneeCascade(itemId, memberId)
        : setWbsAssignee(itemId, memberId),
      stage: stage => setWbsStage(itemId, stage as Stage | null),
      // OFF 는 ready 주문 취소를 동반하는 서버 동작(브리프) — 확인 모달 없이 실행하고 결과 문구로만
      // 알린다(브라우저 confirm() 은 자동화를 막아 세션 규칙상 금지).
      devWorkflow: enabled => setWbsDevWorkflow(itemId, enabled, hasChildren && devCascadeRef.current),
    },
    onSaved: (key, value, res) => {
      if (key === 'assigneeMemberId') {
        if (typeof res.count === 'number' && res.count > 0) setCascadeResult(res.count)
        // 하위 UPDATE 만 실패한 부분 성공(리뷰 라운드 2) — 본인 반영은 확정됐으므로 성공 취급하되
        // "하위 일괄 적용은 실패했다"는 사실은 별도 경고로 알린다(assigneeCascadeFail 키 재사용).
        if (res.cascadeFailed) setCascadeWarn(true)
      } else if (key === 'stage') {
        const stage = value as string | null
        setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage } : prev))
      } else {
        if (typeof res.count === 'number' && res.count > 0) setDevWorkflowResult(res.count)
        if (res.cascadeFailed) setDevWorkflowWarn(true)
      }
    },
    onFailed: (key, value, error) => {
      const usedCascade = key === 'assigneeMemberId' && hasChildren && cascadeRef.current && value !== null
      setErr(error || (usedCascade ? t('wbs.assigneeCascadeFail') : t('wbs.errGeneric')))
    },
    onFlushed: async ({ saved, detached }) => {
      // 배정·dev workflow 성공은 서버가 stage 도 함께 바꿀 수 있다(배정↔as 자동 전이·자동 발행) —
      // 부분 낙관 갱신 대신 전체 재조회로 loaded 를 교체한다(F2, 최종 리뷰). 재조회 실패는 기존 로딩
      // 관례대로 'error'. 분리 flush(패널이 닫혔거나 항목이 바뀜)면 재조회할 패널이 없다.
      if (!detached && saved.some(k => k === 'assigneeMemberId' || k === 'devWorkflow')) {
        const refreshed = await getWbsAssigneeStage(itemId)
        setLoaded(refreshed ?? 'error')
      }
      router.refresh()
    },
  })

  function onAssigneeChange(memberId: string | null) {
    setErr(null); setCascadeResult(null); setCascadeWarn(false)
    quick.set('assigneeMemberId', memberId)
  }
  function onStageChange(stage: Stage | null) {
    setErr(null)
    quick.set('stage', stage)
  }
  function onDevWorkflowChange(enabled: boolean) {
    setErr(null); setDevWorkflowResult(null); setDevWorkflowWarn(false)
    quick.set('devWorkflow', enabled)
  }

  const memberName = (id: string | null) => id ? members.find(m => m.id === id)?.name ?? id : null
  // 낙관 표시값 — 대기 중인 변경이 있으면 그 값, 없으면 서버 확정 값. loaded 가 객체일 때만 쓰인다.
  const view: AssigneeStage = quick.view ?? { assigneeMemberId: null, stage: null, devWorkflow: false }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface-2/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            <User className="h-3.5 w-3.5" /> {t('wbs.assigneeStagePanelTitle')}
          </div>
          <PendingSaveChip
            isPending={quick.isPending} saving={quick.saving} remainingMs={quick.remainingMs}
            onSaveNow={() => void quick.flush()}
          />
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
                      value={view.assigneeMemberId}
                      onChange={onAssigneeChange}
                      categoryOrder={teamCodes}
                      unassignedLabel={t('wbs.assigneeUnassignedOption')}
                      placeholder={t('wbs.assigneeSearchPlaceholder')}
                      noResultsLabel={t('wbs.assigneeSearchNoResults')}
                      ariaLabelledBy={assigneeLabelId}
                    />
                  ) : (
                    <p className="text-[13px] text-ink">{memberName(view.assigneeMemberId) ?? t('wbs.assigneeUnassignedOption')}</p>
                  )}
                  {editable && hasChildren && (
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-line"
                        checked={cascade}
                        onChange={e => setCascade(e.target.checked)}
                      />
                      {t('wbs.assigneeCascadeLabel')}
                    </label>
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.stageLabel')}</span>
                  {editable ? (
                    <select
                      value={view.stage ?? ''}
                      onChange={e => onStageChange((e.target.value || null) as Stage | null)}
                      className="app-input h-9 text-xs"
                    >
                      <option value="">{t('wbs.stageNoneOption')}</option>
                      {/* 개발 워크플로 단계는 최종단계의 것이다 — 상위 항목에서는 서버(setWbsStage)가
                          거절하므로 고를 수 있게 두면 화면이 거절당할 값을 권하는 꼴이 된다.
                          '미착수'는 남긴다: 이미 잘못 찍힌 값을 지울 길이 여기뿐이다. */}
                      {!hasChildren && STAGES.map(s => <option key={s} value={s}>{t(STAGE_KEYS[s])}</option>)}
                    </select>
                  ) : (
                    <p className="text-[13px] text-ink">
                      {view.stage && STAGE_KEYS[view.stage as Stage] ? t(STAGE_KEYS[view.stage as Stage]) : t('wbs.stageNoneOption')}
                    </p>
                  )}
                  {editable && hasChildren && (
                    <p className="mt-1 text-[11px] text-ink-subtle">{t('wbs.stageLeafOnlyHint')}</p>
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
                    checked={view.devWorkflow}
                    onChange={e => onDevWorkflowChange(e.target.checked)}
                    disabled={!editable}
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
      {/* 선행·후행 항목 — 명세에서 분리한 독립 섹션(실행 순서 축). */}

      <WbsSpecPanel itemId={itemId} editable={editable} />
    </div>
  )
}
