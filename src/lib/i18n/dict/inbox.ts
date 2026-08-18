// inbox(알림함) 화면 사전 — 이 파일은 inbox 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
export const inboxKo = {
  'inbox.title': '알림',
  'inbox.personal': '내 알림',
  'inbox.announcements': '공지',
  'inbox.derived': '지연 · 마감 임박',
  'inbox.empty': '새 알림이 없습니다. 👍',
  'inbox.markAllRead': '모두 읽음',
  'inbox.loadFailed': '알림을 불러오지 못했습니다',
  'inbox.announceUnread': '안읽은 공지',
  'inbox.viewAnnouncements': '공지사항 보기',
} as const
