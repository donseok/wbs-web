'use client'
// 결정 칩(과제 C, 스펙 §7.3) — 승인 대기 좌석에 워커가 스스로 고른 결정이 딸렸다는 신호.
// 말풍선(10분·2줄 클램프)과 달리 승인될 때까지 계속 보인다. 수는 좌석표의 decision_count 다(본문은 상세 패널이 읽는다).
export function DecisionChip({ count }: { count: number | null | undefined }) {
  if (count === null || count === undefined || count < 1) return null
  return (
    <span data-decision-chip={count} title={`확인 필요 결정 ${count}건 — 상세에서 목록을 확인하세요`}
      className="inline-flex shrink-0 items-center rounded-full bg-accent-warning/15 px-1.5 text-[10px] font-semibold text-accent-warning">
      결정 {count}
    </span>
  )
}
