// src/lib/domain/inbox.ts — 알림함 순수 도메인. I/O 없음.
// 카탈로그 정본: docs/superpowers/specs/2026-08-11-notification-inbox-design.md
// noise 가 알림함의 최대 실패 요인 — 기본값은 보수적으로, REQUIRED 는 승인 요청류만.

export type NotificationCategory = 'work' | 'issue' | 'meeting' | 'announce' | 'system'

export const NOTIFICATION_CATALOG = {
  // A. 작업 루프 — 발행 지점은 연동 부록 §2.10 (연동 배포 후 활성화)
  'work.assigned':       { category: 'work',   defaultOn: true,  required: false },
  'work.order_created':  { category: 'work',   defaultOn: true,  required: false },
  'work.claimed':        { category: 'work',   defaultOn: true,  required: false },
  'work.progress':       { category: 'work',   defaultOn: false, required: false },
  'work.reported':       { category: 'work',   defaultOn: true,  required: true },
  'work.approved':       { category: 'work',   defaultOn: true,  required: false },
  'work.rejected':       { category: 'work',   defaultOn: true,  required: true },
  'work.released':       { category: 'work',   defaultOn: true,  required: false },
  'work.revoked':        { category: 'work',   defaultOn: true,  required: false },
  'work.unblocked':      { category: 'work',   defaultOn: true,  required: false },
  'work.human_gate':     { category: 'work',   defaultOn: true,  required: false },
  // B. 협업 — issue.assigned 가 v1 첫 발행 지점(Task 5)
  'issue.assigned':      { category: 'issue',  defaultOn: true,  required: false },
  'issue.status':        { category: 'issue',  defaultOn: true,  required: false },
  'member.invited':      { category: 'system', defaultOn: true,  required: false },
  // C. 시스템
  'system.pat_expiring': { category: 'system', defaultOn: true,  required: false },
  'system.import_result':{ category: 'system', defaultOn: true,  required: false },
  'system.runner_stale': { category: 'system', defaultOn: false, required: false },
} as const satisfies Record<string, { category: NotificationCategory; defaultOn: boolean; required: boolean }>

export type NotificationType = keyof typeof NOTIFICATION_CATALOG

export function categoryOf(type: NotificationType): NotificationCategory {
  return NOTIFICATION_CATALOG[type].category
}

/** 조회 시점 필터 — 발행 시 수신자별 prefs 조회를 피하고, 토글이 소급 적용되게 한다.
 * type 이 카탈로그 밖(미지·삭제된 타입)이면 fail-closed 로 숨긴다 — 피드 전체를 죽이지 않는다. */
export function isTypeEnabled(prefs: Record<string, boolean> | undefined, type: NotificationType): boolean {
  const entry: (typeof NOTIFICATION_CATALOG)[NotificationType] | undefined = NOTIFICATION_CATALOG[type]
  if (!entry) return false
  if (entry.required) return true
  return prefs?.[type] ?? entry.defaultOn
}

/** 중복·null 제거 + 행위자 제외 — 자기 행위는 자기에게 알리지 않는다. */
export function normalizeRecipientUserIds(
  userIds: ReadonlyArray<string | null | undefined>, actorUserId: string | null | undefined,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of userIds) {
    if (!id || id === actorUserId || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
