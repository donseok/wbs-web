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
  // 조치 경과 이력(0087). defaultOn 을 true 로 둔 이유: prefs.notif 를 쓰는 코드가
  // 아직 없어(읽기는 actions/inbox.ts:56 한 곳, 쓰기 0건) false 로 두면 영구히 발행되지
  // 않는 죽은 타입이 된다. 소음은 설계로 억제한다 — 이력 1건당 이벤트 1건(dedupeKey),
  // kind='status' 자동 기록은 발행하지 않음, 담당자 팬아웃 이슈당 평균 2.74명(실측).
  'issue.update':        { category: 'issue',  defaultOn: true,  required: false },
  'issue.mention':       { category: 'issue',  defaultOn: true,  required: false },
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

/** delete-then-insert 담당자 교체에서 "새로 배정된" 사람만 — 재알림 스팸 방지. */
export function computeAddedAssignees(existing: readonly string[], next: readonly string[]): string[] {
  const had = new Set(existing)
  return next.filter(id => !had.has(id))
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
