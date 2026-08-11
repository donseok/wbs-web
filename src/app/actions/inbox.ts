// src/app/actions/inbox.ts — 알림함 조회·읽음. 조회는 RLS(본인 행), 쓰기는 admin + 세션 가드
// (0074 는 쓰기 정책 0 — 서버 액션 가드가 유일한 관문).
'use server'

import { getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTypeEnabled, type NotificationType } from '@/lib/domain/inbox'
import type { UiPrefs } from '@/lib/domain/types'

export type InboxItem = {
  recipientId: string
  type: string
  category: string
  title: string
  detail: string | null
  href: string | null
  createdAt: string
  seen: boolean
  read: boolean
}

type EventRow = {
  type: string; category: string
  payload: { title?: string; detail?: string; href?: string } | null
  created_at: string
}
type RecipientRow = {
  id: string; seen_at: string | null; read_at: string | null; created_at: string
  notification_events: EventRow | EventRow[] | null
}

/** 개인 피드 + unseen 배지. 공지(전체 알림) 합산은 화면에서 getUnreadAnnouncementCount 와 병렬 호출. */
export async function getInboxFeed(limit = 30): Promise<{ items: InboxItem[]; unseen: number; failed?: true }> {
  const user = await getSession()
  if (!user) return { items: [], unseen: 0 }
  const sb = await createServerClient()

  const { data, error } = await sb
    .from('notification_recipients')
    .select('id, seen_at, read_at, created_at, notification_events(type, category, payload, created_at)')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[inbox] 피드 조회 실패', error.message)
    return { items: [], unseen: 0, failed: true }
  }

  const { data: prefRow } = await sb
    .from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle()
  const notifPrefs = ((prefRow?.prefs as UiPrefs | null)?.notif) ?? undefined

  const items: InboxItem[] = []
  for (const r of (data ?? []) as RecipientRow[]) {
    const ev = Array.isArray(r.notification_events) ? r.notification_events[0] : r.notification_events
    if (!ev) continue
    if (!isTypeEnabled(notifPrefs, ev.type as NotificationType)) continue
    items.push({
      recipientId: r.id,
      type: ev.type,
      category: ev.category,
      title: ev.payload?.title ?? ev.type,
      detail: ev.payload?.detail ?? null,
      href: ev.payload?.href ?? null,
      createdAt: r.created_at,
      seen: r.seen_at != null,
      read: r.read_at != null,
    })
  }
  return { items, unseen: items.filter(i => !i.seen).length }
}

/** 벨 열람 — unseen 전체 소등(배지 0). 항목의 읽음(read)과는 별개. */
export async function markInboxSeen(): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  const { error } = await admin
    .from('notification_recipients')
    .update({ seen_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('seen_at', null)
  if (error) console.error('[inbox] seen 처리 실패', error.message)
  return { ok: !error }
}

/** '모두 읽음' — read+seen 동시 처리. */
export async function markAllInboxRead(): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user) return { ok: false }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('notification_recipients')
    .update({ read_at: now, seen_at: now })
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) console.error('[inbox] 모두 읽음 실패', error.message)
  return { ok: !error }
}

/** 항목 클릭 — 개별 읽음. 본인 행 한정(eq user_id)이 소유 검증이다. */
export async function markInboxItemRead(recipientId: string): Promise<{ ok: boolean }> {
  const user = await getSession()
  if (!user || typeof recipientId !== 'string') return { ok: false }
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('notification_recipients')
    .update({ read_at: now, seen_at: now })
    .eq('id', recipientId)
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) console.error('[inbox] 읽음 처리 실패', error.message)
  return { ok: !error }
}
