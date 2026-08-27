'use client'
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import type { ChangeLogEntry } from '@/app/actions/wbs'
import type { TeamCode } from '@/lib/domain/types'
import { formatWeightPct } from '@/lib/domain/format'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SPEC_UPDATED_TOKEN } from '@/lib/domain/wbsSpecLog'
import type { DictKey } from '@/lib/i18n/dict'

/** 접기 전 기본 노출 건수 — 이력은 항목당 수십 건까지 쌓이는데 패널의 주인공이 아니다. */
export const HISTORY_COLLAPSED_COUNT = 3

type Tr = (k: DictKey) => string
const ROLE_KEY: Record<string, DictKey> = { pmo_admin: 'wbs.rolePmoAdmin', team_editor: 'wbs.roleTeamEditor' }
const FIELD_KEY: Record<string, DictKey> = {
  actual_pct: 'wbs.colActualPct', weight: 'wbs.colWeight', name: 'wbs.fieldName', planned_start: 'wbs.colPlannedStart',
  planned_end: 'wbs.colPlannedEnd', deliverable: 'wbs.colDeliverable', biz: 'wbs.fieldBiz', created: 'wbs.fieldCreated',
  dependency: 'wbs.dependencies',
  // Task 12(stage)·Task 12A(spec) 가 change_logs 에 기록하는 필드명 — 매핑이 없으면 이 화면의
  // 변경 이력 라벨이 원문 그대로("stage"/"spec") 노출된다(fmtValue 는 값만 다루고 라벨은 이 맵이 정본).
  stage: 'wbs.stageLabel', spec: 'wbs.specPanelTitle',
}

function fmtValue(field: string, v: string | null, t: Tr): string {
  if (v == null || v === '') return field === 'weight' ? t('wbs.weightEqual') : '—'
  if (field === 'dependency') return t('wbs.dependencyLink')
  if (field === 'weight' && !Number.isNaN(Number(v))) return formatWeightPct(Number(v))
  // spec 은 본문 전문을 로그에 넣지 않고 로케일 중립 토큰만 저장한다(wbsSpecLog.ts) — 여기서
  // 사전 키로 변환. 리터럴 한국어를 그대로 저장하면 en 사용자 이력에도 노출된다(리뷰 라운드 1).
  if (field === 'spec' && v === SPEC_UPDATED_TOKEN) return t('wbs.specUpdatedLogValue')
  return field === 'actual_pct' ? `${v}%` : v
}

function fmtAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function actorLabel(team: TeamCode | null, role: string | null, t: Tr): string {
  const r = role ? (ROLE_KEY[role] ? t(ROLE_KEY[role]) : role) : null
  if (team && r) return `${team} · ${r}`
  return r ?? team ?? t('wbs.unknownActor')
}

/**
 * 변경 이력 — 항목당 한 줄, 기본 최근 3건(2026-08-28). 종전에는 3줄짜리 카드가 이력 수만큼
 * 쌓여 상세 패널의 절반 이상을 먹었다. RowDetailPanel 에서 떼어낸 이유는 두 가지다:
 * 그 파일이 700줄을 넘었고, 이 블록만 따로 테스트하려면 패널 전체를 모킹해야 했다.
 */
export function ChangeHistoryList({ logs }: { logs: ChangeLogEntry[] | null }) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  // 다른 항목을 열면 접힌 상태로 돌아간다 — 앞 항목에서 펼친 게 따라오면 "왜 다 보이지"가 된다.
  useEffect(() => { setExpanded(false) }, [logs])

  const hidden = logs ? Math.max(0, logs.length - HISTORY_COLLAPSED_COUNT) : 0
  const shown = logs && !expanded ? logs.slice(0, HISTORY_COLLAPSED_COUNT) : logs

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        <History className="h-3.5 w-3.5" /> {t('wbs.changeHistory')}
      </div>
      {shown == null ? (
        <p className="text-xs text-ink-subtle">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-ink-subtle">{t('wbs.noHistory')}</p>
      ) : (
        <>
          <ol className="divide-y divide-line/50 border-y border-line/50">
            {shown.map(log => (
              <li key={log.id} data-history-row
                className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 py-1 text-[12px] sm:grid-cols-[8.5rem_1fr_auto]">
                <span className="tabular-nums text-[11px] text-ink-subtle">{fmtAt(log.at)}</span>
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-ink">{FIELD_KEY[log.field] ? t(FIELD_KEY[log.field]) : log.field}</span>
                  <span className="mx-1 text-ink-muted line-through decoration-ink-subtle/50">{fmtValue(log.field, log.oldValue, t)}</span>
                  <span className="text-ink-subtle">→</span>
                  <span className="ml-1 font-semibold text-ink">{fmtValue(log.field, log.newValue, t)}</span>
                </span>
                <span className="col-start-2 text-[11px] text-ink-subtle sm:col-start-3">{actorLabel(log.actorTeam, log.actorRole, t)}</span>
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <button type="button" data-history-more onClick={() => setExpanded(v => !v)}
              className="mt-1.5 text-[11px] font-medium text-ink-muted underline-offset-2 hover:underline">
              {expanded ? t('wbs.historyCollapse') : t('wbs.historyExpand').replace('{n}', String(hidden))}
            </button>
          )}
        </>
      )}
    </section>
  )
}
