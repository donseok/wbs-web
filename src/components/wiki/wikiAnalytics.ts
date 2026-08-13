'use client'

import type { WikiAnalyticsEvent } from '@/lib/domain/wikiAnalytics'

/** 실패가 업무 흐름을 막지 않는 fire-and-forget 제품 이벤트. */
export function trackWikiEvent(
  eventName: WikiAnalyticsEvent,
  path: string,
  metadata: Record<string, string | number | boolean | null> = {},
): void {
  void fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, eventName, metadata }),
    keepalive: true,
  }).catch(() => {})
}
