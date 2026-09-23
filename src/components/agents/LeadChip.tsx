// src/components/agents/LeadChip.tsx — 팀장 lease 칩(0101). 평면도 층 머리(FloorCard)와
// 에이전트 보기 팀장 책상(RosterBoard)이 같이 쓴다 — 스펙 §7: "오피스 화면의 팀장 좌석에 lease 표시".
'use client'
import { useState } from 'react'
import type { LeadLease } from '@/lib/domain/seatmap'
import css from './seatmap.module.css'

/**
 * 두 단계 확인(브라우저 confirm() 은 쓰지 않는다. E2E 자동화가 대화상자에 막힌다).
 * `projectLabel` — 에이전트 보기는 한 책상(identity)이 여러 프로젝트의 팀장일 수 있어 칩끼리 구분할
 * 근거가 필요하다(FloorCard 는 층 헤더 자체가 프로젝트라 생략).
 * `hideHost` — 에이전트 보기 팀 머리는 이미 작업 PC 이름을 달고 있어 칩에서 뺀다(2026-09-24 사용자 요청).
 */
export function LeadChip({ lead, onRelease, projectLabel, hideHost }: { lead: LeadLease; onRelease?: () => Promise<void>; projectLabel?: string; hideHost?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const who = lead.mine ? '내 팀장' : `${lead.ownerName ?? '다른 계정'} 팀장`
  const at = lead.renewedAt ? new Date(lead.renewedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'
  return (
    <span className={css.lead} data-lead={lead.userId} title={`${lead.agent ?? ''} · 갱신 ${at}`}>
      {who}{projectLabel ? ` · ${projectLabel}` : ''}{hideHost ? '' : ` · ${lead.host ?? '-'}`} · 갱신 {at}
      {lead.canRelease && onRelease && !confirming && (
        <button type="button" className={css.leadRelease} disabled={busy} onClick={() => setConfirming(true)}>팀장 해제</button>
      )}
      {confirming && (
        <>
          <button type="button" className={css.leadRelease} data-lead-confirm disabled={busy}
            onClick={async () => { setBusy(true); try { await onRelease?.() } finally { setBusy(false); setConfirming(false) } }}>
            정말 해제
          </button>
          <button type="button" className={css.leadRelease} disabled={busy} onClick={() => setConfirming(false)}>취소</button>
        </>
      )}
    </span>
  )
}
