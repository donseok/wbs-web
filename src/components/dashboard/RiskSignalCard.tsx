import Link from 'next/link'
import { Siren } from 'lucide-react'
import type { EvidenceRef, RiskSeverity, RiskSignalReport } from '@/lib/domain/riskSignals'
import { minuteSourceHref } from '@/lib/minutes/source'
import { SectionCard } from '@/components/ui/SectionCard'
import { MiniEmpty } from './bits'
import { SIGNAL_META } from './signalStyle'

/**
 * 위험 신호 카드 — riskSignals 엔진(규칙 기반 탐지 5종)의 결과를 그대로 보여준다.
 *
 * 왜 "예측"이 아닌가: 신호는 기존 대시보드 지표(진척 정체·에이징·SPI 등)의 재조합이라
 * ExecSummary·RiskWorklist와 절대 모순되지 않고, 모든 신호는 evidence 딥링크(WBS 행 focus /
 * 회의록 원문 블록)로 사용자가 원문에서 직접 검증할 수 있다 — 헤더의 '규칙 기반 탐지' 칩이
 * 이 계약의 UI 명문화다. LLM 없이 완결되는 결정형 카드라 AI 해설 실패·부재와 무관하게 항상 유효.
 *
 * 정직한 무신호: 신호 0건은 빈 카드 숨김이 아니라 MiniEmpty로 명시하고, 탐지가 구조적으로
 * 침묵하는 조건(SPI 스냅샷 이력 부족, 계획 데이터 미비)은 캐비앗으로 함께 표기한다 —
 * '조용한 무신호'가 '위험 없음'으로 위장되지 않게(silent-empty 3원칙).
 *
 * 텍스트는 RiskWorklist 선례에 따라 한국어 하드코딩(i18n 전면 번역 보류 결정과 일치).
 */

/** severity → 행 테두리 틴트(RiskWorklist ROW_META 미러) + 색맹 대응 텍스트 라벨(SignalTile statusText 관례). */
const SEVERITY_META: Record<RiskSeverity, { border: string; label: string }> = {
  red: { border: 'border-delayed/40', label: '심각' },
  amber: { border: 'border-accent-warning/40', label: '주의' },
}

/**
 * minute_block evidence 의 bodyHash 보강 소스 — EvidenceRef 는 도메인 지문(fingerprint) 안정성을
 * 위해 bodyHash 를 담지 않으므로, 대시보드가 이미 들고 있는 회의 인사이트 목록에서 되찾는다.
 * MinuteSignal(components/dashboard/MinuteSignals)·MinuteActionSignal(domain/riskSignals) 모두 구조 호환.
 */
export interface MinuteAnchorSource {
  minuteId: string
  blockIndex: number
  blockHash: string
  bodyHash: string
}

const anchorKey = (minuteId: string, blockIndex: number, blockHash: string) =>
  `${minuteId}#${blockIndex}#${blockHash}`

/**
 * evidence → 딥링크. wbs_item 은 RiskWorklist 와 동일한 focus 점프, minute_block 은 minuteSourceHref
 * 앵커. bodyHash 를 되찾지 못하면(인사이트 목록 밖 참조) 앵커 없이 회의록 문서로 폴백 —
 * 링크를 조용히 숨기는 대신 검증 경로를 유지한다. 참조 자체가 불완전하면 null(라벨만 표기).
 */
function evidenceHref(e: EvidenceRef, projectId: string, bodyHashOf: Map<string, string>): string | null {
  if (e.type === 'wbs_item') return e.itemId ? `/p/${projectId}/wbs?focus=${e.itemId}` : null
  if (!e.minuteId) return null
  const bodyHash = e.blockIndex != null && e.blockHash
    ? bodyHashOf.get(anchorKey(e.minuteId, e.blockIndex, e.blockHash))
    : undefined
  return bodyHash != null && e.blockIndex != null && e.blockHash
    ? minuteSourceHref(e.minuteId, { blockIndex: e.blockIndex, blockHash: e.blockHash, bodyHash })
    : `/minutes/${e.minuteId}`
}

export function RiskSignalCard({ report, projectId, minuteSignals = [], trendSparse = false }: {
  report: RiskSignalReport
  projectId: string
  /** minute_block evidence 앵커 복원용 — 대시보드가 이미 페치한 회의 인사이트 재사용(신규 페치 없음). */
  minuteSignals?: MinuteAnchorSource[]
  /** SPI 시계열 표본 부족(지연 추세 신호 판정 불가) — 조용한 무신호 위장 방지 캐비앗. */
  trendSparse?: boolean
}) {
  const bodyHashOf = new Map(minuteSignals.map(s => [anchorKey(s.minuteId, s.blockIndex, s.blockHash), s.bodyHash]))
  const overall = SIGNAL_META[report.overall]

  // 탐지기가 구조적으로 침묵하는 조건 — 무신호·유신호 모두에 표기해 '위험 없음'과 구분한다.
  const caveats: string[] = []
  if (trendSparse) caveats.push('SPI 스냅샷 이력이 부족해(3회 미만) 지연 추세 신호는 아직 판정할 수 없습니다.')
  if (!report.hygiene.clean) {
    caveats.push(
      `계획 데이터 미비(담당 미지정 ${report.hygiene.noOwner} · 일정 미입력 ${report.hygiene.noDates} · 가중치 혼재 ${report.hygiene.mixedWeight}) — 신호가 실제보다 적게 감지될 수 있습니다.`,
    )
  }

  return (
    <SectionCard eyebrow="RISK SIGNALS" title="위험 신호" icon={Siren}
      actions={
        <>
          <span className="chip bg-surface-2 text-ink-subtle">규칙 기반 탐지</span>
          <span className={`chip ${overall.chip}`}>신호 {report.signals.length}건</span>
        </>
      }>
      {report.signals.length === 0 ? <MiniEmpty text="감지된 위험 신호 없음" /> : (
        <div className="space-y-2">
          {report.signals.map(s => {
            const sev = SEVERITY_META[s.severity]
            return (
              <div key={s.id} className={`rounded-xl border ${sev.border} px-3 py-2.5`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SIGNAL_META[s.severity].dot}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{s.title}</span>
                  <span className={`chip shrink-0 ${SIGNAL_META[s.severity].chip}`}>{sev.label}</span>
                </div>
                {/* detail 이 근거 수치(건수·갭·SPI)를 담는다 — 수치는 엔진 산출 그대로, 여기서 재계산 금지 */}
                <p className="mt-1 pl-4 text-xs leading-5 text-ink-muted">{s.detail}</p>
                {s.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-4">
                    {s.evidence.map((e, i) => {
                      const href = evidenceHref(e, projectId, bodyHashOf)
                      const key = `${s.id}:${i}`
                      if (!href) return <span key={key} className="chip max-w-56 truncate bg-surface-2 text-ink-subtle">{e.label}</span>
                      const action = e.type === 'wbs_item' ? 'WBS에서 열기' : '회의록 원문 위치 열기'
                      return (
                        <Link key={key} href={href} title={action} aria-label={`${e.label}, ${action}`}
                          className="chip max-w-56 truncate bg-surface-2 text-ink-muted transition hover:bg-brand-weak hover:text-brand">
                          {e.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {caveats.length > 0 && (
        <ul className="mt-3 space-y-1">
          {caveats.map(c => <li key={c} className="text-[11px] leading-4 text-ink-subtle">· {c}</li>)}
        </ul>
      )}
    </SectionCard>
  )
}
