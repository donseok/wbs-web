'use client'
import { useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { ensureProjectBriefAction, type WeeklyBriefPayload } from '@/app/actions/brief'

/**
 * 주간 AI 브리핑 섹션 — 통합 카드(D1)의 상단부. 트리거는 버튼 온디맨드 전용:
 * 열람 자동 생성을 절대 추가하지 말 것(무료 쿼터 보호의 핵심 설계, LLM 예산 안전 조건).
 *
 * 렌더는 순수 텍스트만(MinuteInsightCard 원칙 — 링크화·마크다운 HTML 금지 = 인젝션 차단).
 * kpiLine 은 LLM 산출이 아니라 결정형 코드 조립이라 브리핑 유무와 무관하게 항상 표기.
 * 실패는 정직한 안내로 강등(조용한 빈 섹션 금지) — 신호 목록(하단)은 LLM 과 무관하게 유효.
 */

export interface WeeklyBriefInitial {
  headline: string
  bodyMd: string
  updatedAt: string
  model: string
  fresh: boolean
}

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))

/** 마크다운 본문을 순수 텍스트 줄로 — '##' 헤더/불릿만 시각 구분, HTML 렌더 없음. */
function BriefBody({ bodyMd }: { bodyMd: string }) {
  const lines = bodyMd.split('\n').map(l => l.trim()).filter(Boolean)
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('##')) {
          return <p key={i} className="pt-1.5 text-xs font-semibold text-ink">{line.replace(/^#+\s*/, '')}</p>
        }
        const bullet = /^[-*]\s+/.test(line)
        return (
          <p key={i} className={`text-xs leading-5 text-ink-muted ${bullet ? 'pl-3' : ''}`}>
            {bullet ? `· ${line.replace(/^[-*]\s+/, '')}` : line}
          </p>
        )
      })}
    </div>
  )
}

export function WeeklyBriefSection({ projectId, kpiLine, baseDate, realToday, initial }: {
  projectId: string
  kpiLine: string
  baseDate: string
  realToday: string
  initial: WeeklyBriefInitial | null
}) {
  const [brief, setBrief] = useState<WeeklyBriefInitial | null>(initial)
  const [busy, setBusy] = useState(false)
  // 실패·제한은 기존 브리핑을 숨기지 않고 안내를 병기한다(리뷰 확정: 쿨다운 응답이
  // 유효 bodyMd 를 담고 와도 전면 실패로 처리해 방금 본 콘텐츠가 사라지는 결함).
  const [notice, setNotice] = useState<string | null>(null)

  const generate = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const before = brief?.updatedAt
    try {
      const r: WeeklyBriefPayload = await ensureProjectBriefAction(projectId, { force: !!brief })
      if (r.bodyMd != null) {
        setBrief({
          headline: r.headline ?? '', bodyMd: r.bodyMd, updatedAt: r.updatedAt ?? '',
          model: r.model ?? '', fresh: r.fresh ?? true,
        })
        // force 재생성인데 행이 갱신되지 않았다면(쿨다운/LLM 실패 — 게이트는 사후 검증이라
        // 'generated'로 보일 수 있음, 리뷰 확정) updatedAt 비교로 감지해 정직하게 안내한다.
        if (before && r.updatedAt === before) {
          setNotice('새 브리핑이 생성되지 않아 기존 브리핑을 유지합니다(생성 제한 또는 일시 실패). 잠시 후 다시 시도해 주세요.')
        }
      } else {
        setNotice('AI 응답이 잠시 원활하지 않습니다. 잠시 후 다시 시도해 주세요 — 아래 위험 신호 목록은 규칙 기반이라 항상 유효합니다.')
      }
    } catch (e) {
      // 서버 액션 reject(네트워크 등) — 정직한 실패 표시(로깅은 서버가 담당)
      console.error('[brief] 생성 요청 실패:', e)
      setNotice('요청에 실패했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 flex-1 text-xs font-semibold text-ink">주간 AI 브리핑</span>
        {brief && !brief.fresh && (
          <span className="chip shrink-0 bg-pending-weak text-accent-warning">기준 데이터 변경됨</span>
        )}
        <button type="button" onClick={generate} disabled={busy}
          className="btn btn-ghost !px-2.5 !py-1 !text-xs disabled:opacity-60">
          {busy
            ? <><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> 생성 중…</>
            : brief
              ? <><RefreshCw className="h-3 w-3" aria-hidden /> 다시 생성</>
              : <><Sparkles className="h-3 w-3" aria-hidden /> AI 브리핑 생성</>}
        </button>
      </div>

      {/* 결정형 KPI — 수치의 단일 출처는 대시보드 도메인 함수(LLM 산출 아님) */}
      <p className="mt-2 text-sm font-medium text-ink">{kpiLine}</p>

      {/* 안내는 콘텐츠와 병기 — 기존 브리핑을 숨기지 않는다(조용한 콘텐츠 소실 금지) */}
      {notice && <p className="mt-2 text-xs leading-5 text-accent-warning">{notice}</p>}

      {brief && (
        <div className="mt-2">
          {brief.headline && <p className="text-sm font-semibold text-ink">{brief.headline}</p>}
          {brief.bodyMd && <div className="mt-1.5"><BriefBody bodyMd={brief.bodyMd} /></div>}
          <p className="mt-2 text-[11px] leading-4 text-ink-subtle">
            생성 {brief.updatedAt ? timeLabel(brief.updatedAt) : '-'}{brief.model ? ` · ${brief.model}` : ''} ·
            진척·리스크 기준일 {baseDate} / 회의·회의록 {realToday}
          </p>
        </div>
      )}

      {!brief && !notice && (
        <p className="mt-1.5 text-xs leading-5 text-ink-subtle">
          버튼을 누르면 현재 대시보드 수치를 근거로 AI가 이번 주 브리핑을 작성합니다.
          진척·리스크는 기준일({baseDate}), 회의·회의록은 오늘({realToday}) 기준입니다.
        </p>
      )}
    </div>
  )
}
