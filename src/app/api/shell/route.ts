// 앱 셸 상태(알림함·파생 알림·공지 배지·헤더 티커) 통합 조회 — 2026-08-18 성능 감사 P0.
//
// 종전에는 HeaderChrome/Sidebar/HeaderAnnouncementTicker/PrefsSync 가 마운트·내비게이션마다
// 서버 액션 4~6개를 각자 POST 했다. 서버 액션은 클라이언트당 직렬 큐로 실행되므로
// (React 사양) 사용자 RTT 가 큰 환경에서 내비게이션마다 0.6s × N 이 순차로 쌓였고,
// 사용자가 그 직후 누른 실제 액션도 같은 큐 뒤에서 대기했다.
//
// 이 라우트는 그 전부를 GET 1왕복으로 합친다. GET 이므로 액션 큐와 경쟁하지 않는다.
// 각 조회 함수가 내부에서 세션을 스스로 확인하므로(비로그인 = 빈 값) 별도 가드가 필요 없고,
// 응답은 개인화 데이터라 no-store 다.
import { type NextRequest, NextResponse } from 'next/server'
import { getInboxFeed } from '@/app/actions/inbox'
import { getNotifications } from '@/app/actions/notifications'
import { getHeaderAnnouncements, getUnreadAnnouncementCount } from '@/app/actions/announcements'

export async function GET(req: NextRequest) {
  // route = 현재 URL 의 프로젝트(파생 알림·티커 기준), menu = 메뉴 문맥 프로젝트(공지 배지 기준 —
  // 전역 화면에서도 사이드바가 최근 프로젝트의 배지를 유지하는 기존 시맨틱을 따른다).
  const route = req.nextUrl.searchParams.get('route') || null
  const menu = req.nextUrl.searchParams.get('menu') || null

  const [inbox, notifications, unreadAnnouncements, headerAnnouncements] = await Promise.all([
    getInboxFeed(),
    // 파생 알림은 실패해도 벨 전체를 죽이지 않는다(기존 HeaderChrome catch(() => {}) 시맨틱).
    route ? getNotifications(route).catch(() => null) : Promise.resolve(null),
    menu ? getUnreadAnnouncementCount(menu).catch(() => 0) : Promise.resolve(0),
    route ? getHeaderAnnouncements(route).catch(() => [] as Awaited<ReturnType<typeof getHeaderAnnouncements>>) : Promise.resolve([]),
  ])

  return NextResponse.json(
    { inbox, notifications, unreadAnnouncements, headerAnnouncements },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
