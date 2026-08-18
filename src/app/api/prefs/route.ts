// 백그라운드 설정 저장(디바운스) 전용 라우트 — 2026-08-18 성능 후속.
//
// 왜 서버 액션이 아니라 라우트인가: Next 는 **서버 액션이 성공할 때마다 클라이언트
// 라우터 캐시 전체를 비운다**. queueUiPref 는 프로젝트 메뉴 이동마다 최근 프로젝트를
// 저장하므로(ProjectNavigationContext), 액션으로 두면 내비게이션마다 캐시가 비워져
// experimental.staleTimes(30s) 가 사실상 무효였다(실측). 설정 저장은 화면 RSC 내용을
// 바꾸지 않는 부차 쓰기라 캐시를 비울 이유가 없다 — 일반 POST 로 옮긴다.
//
// 인가는 내부 함수가 세션으로 판정한다(비로그인 = no-op, 본인 행만 upsert).
// CSRF: JSON content-type 은 cross-origin 에서 preflight 를 강제하고 이 라우트는 CORS
// 를 열지 않으므로 타 사이트발 쓰기는 차단된다(+ SameSite=Lax 쿠키).
import { type NextRequest, NextResponse } from 'next/server'
import { saveUiPrefs, saveWbsCollapse } from '@/app/actions/preferences'
import type { UiPrefs } from '@/lib/domain/types'

type Body = {
  prefs?: Partial<UiPrefs>
  wbsCollapse?: { projectId: string; ids: string[] }
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (body.prefs && typeof body.prefs === 'object') await saveUiPrefs(body.prefs)
  const wc = body.wbsCollapse
  if (wc && typeof wc.projectId === 'string' && Array.isArray(wc.ids) && wc.ids.every(x => typeof x === 'string')) {
    await saveWbsCollapse(wc.projectId, wc.ids)
  }
  return NextResponse.json({ ok: true })
}
