import type { ComputedItem, Status, TeamCode } from '@/lib/domain/types'

export const TEAM: Record<TeamCode, { fg: string; bar: string }> = {
  PMO: { fg: 'text-team-pmo', bar: 'bg-team-pmo' },
  가공: { fg: 'text-team-dt', bar: 'bg-team-dt' },
  ERP: { fg: 'text-team-erp', bar: 'bg-team-erp' },
  MES: { fg: 'text-team-mes', bar: 'bg-team-mes' },
  MDM: { fg: 'text-team-mdm', bar: 'bg-team-mdm' },
}

/** 팀 틴트 조회 — 팀별 CSS 토큰은 기존 5팀만 정의돼 있어 팀 마스터의 신규 팀은 중립 틴트. */
export function teamStyle(team: TeamCode): { fg: string; bar: string } {
  return TEAM[team] ?? { fg: 'text-ink-subtle', bar: 'bg-ink-subtle' }
}

export const STATUS: Record<Status, { label: string; chip: string; bar: string; dot: string }> = {
  not_started: { label: '시작전', chip: 'bg-pending-weak text-pending', bar: 'bg-pending', dot: 'bg-pending' },
  in_progress: { label: '진행중', chip: 'bg-progress-weak text-progress', bar: 'bg-progress', dot: 'bg-progress' },
  delayed: { label: '지연', chip: 'bg-delayed-weak text-delayed', bar: 'bg-delayed', dot: 'bg-delayed' },
  done: { label: '완료', chip: 'bg-done-weak text-done', bar: 'bg-done', dot: 'bg-done' },
}

/** ProjectConfig 미주입(구 테스트·데모 등) 폴백 — lib/data/projectConfig.DEFAULT_PROJECT_CONFIG.levelLabels(D-CUBE)와 값이 같아야
 * 회귀 0. shared.tsx 는 클라이언트 컴포넌트에서도 import 되므로, next/headers 를 물고 있는 그 서버 전용 모듈은 참조하지
 * 않고 값만 복제해 둔다. */
export const DEFAULT_LEVEL_LABELS = ['Phase', 'Task', 'Activity']

/** depth(0-based) 별 배지 색 팔레트 — 옛 LEVEL 상수의 cls 를 그대로 재활용(회귀 0). depth 3+ 는 pending 재사용. */
const DEPTH_CLASS = [
  'bg-brand-weak text-brand',       // depth 0 (구 phase)
  'bg-progress-weak text-progress', // depth 1 (구 task)
  'bg-pending-weak text-pending',   // depth 2 (구 activity)
]
const DEPTH_CLASS_FALLBACK = 'bg-surface-2 text-ink-muted' // depth 3+
/* act 하위의 담당자별 분리 항목(임포트 시 자동 생성) 전용 표기 — 일반 배지와 시각 구분 */
const SUB_ACT = { label: 'SUB-ACT', cls: 'bg-surface-2 text-ink-muted' }
/** D-CUBE(levelLabels=[Phase,Task,Activity]) 하위호환 축약 테이블 — 그 외 라벨은 원문 그대로(회귀 0). */
const LEGACY_LABEL_ABBR: Record<string, string> = { Phase: 'PHASE', Task: 'TASK', Activity: 'ACT' }

/** 배지 텍스트 — isOwnerSplit 이면 SUB-ACT, 아니면 levelLabels[depth](D-CUBE 축약 규칙 우선), 라벨 밖 깊이는 'N단'. */
export function levelBadgeText(depth: number, isOwnerSplit: boolean, levelLabels: readonly string[]): string {
  if (isOwnerSplit) return SUB_ACT.label
  const label = levelLabels[depth]
  return LEGACY_LABEL_ABBR[label] ?? label ?? `${depth + 1}단`
}

/** 배지 색 — isOwnerSplit 이면 SUB-ACT 톤, 아니면 depth 기반 팔레트(depth 3+ 는 폴백 재사용). */
export function levelBadgeClass(depth: number, isOwnerSplit: boolean): string {
  if (isOwnerSplit) return SUB_ACT.cls
  return DEPTH_CLASS[depth] ?? DEPTH_CLASS_FALLBACK
}

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function LevelBadge({
  depth,
  isOwnerSplit = false,
  levelLabels,
  compact = false,
}: {
  depth: number
  isOwnerSplit?: boolean
  levelLabels: readonly string[]
  compact?: boolean
}) {
  return (
    <span
      className={`lvl-badge ${levelBadgeClass(depth, isOwnerSplit)}`}
      style={{
        fontSize: 'var(--wbs-badge-font, 10px)',
        ...(compact
          ? {
              maxWidth: '100%',
              overflow: 'hidden',
              paddingInline: '3px',
              letterSpacing: 0,
              whiteSpace: 'nowrap',
            }
          : {}),
      }}
    >
      {levelBadgeText(depth, isOwnerSplit, levelLabels)}
    </span>
  )
}

export function OwnerBadges({
  owners,
  nowrap = false,
}: {
  owners: ComputedItem['owners']
  nowrap?: boolean
}) {
  if (!owners.length) return <span className="text-ink-subtle">-</span>
  return (
    <div className={`flex items-center gap-x-1.5 gap-y-0.5 overflow-hidden ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {owners.map(o => (
        <span
          key={o.team + o.kind}
          className={`inline-flex items-center gap-0.5 font-semibold leading-none ${nowrap ? 'shrink-0' : ''}`}
          style={{ fontSize: 'var(--wbs-owner-font, 10.5px)' }}
          title={o.kind === 'primary' ? `${o.team} 주관` : `${o.team} 지원`}
        >
          <span
            className={`${teamStyle(o.team).fg} ${o.kind === 'support' ? 'opacity-60' : ''} leading-none`}
            style={{ fontSize: 'var(--wbs-owner-mark-font, 9px)' }}
          >
            {o.kind === 'primary' ? '●' : '△'}
          </span>
          <span className="text-ink-muted">{o.team}</span>
        </span>
      ))}
    </div>
  )
}

export function fmtDate(d: string | null): string {
  if (!d) return '-'
  return d.slice(2).replace(/-/g, '.') // 2026-09-15 -> 26.09.15
}

// 리프 수집은 도메인 계층(lib/domain/tree)이 단일 출처 — 여기선 재노출만.
export { collectLeaves } from '@/lib/domain/tree'
