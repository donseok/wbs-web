// inbox 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { inboxKo } from './inbox'

export const inboxEn: Record<keyof typeof inboxKo, string> = {
  'inbox.title': 'Notifications',
  'inbox.personal': 'My notifications',
  'inbox.announcements': 'Announcements',
  'inbox.derived': 'Delayed · Due soon',
  'inbox.empty': 'No new notifications. 👍',
  'inbox.markAllRead': 'Mark all read',
  'inbox.loadFailed': 'Failed to load notifications',
  'inbox.announceUnread': 'unread announcements',
  'inbox.viewAnnouncements': 'View announcements',
}
