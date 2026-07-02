import { cookies } from 'next/headers'
import type { Locale } from './dict'

/**
 * 서버 컴포넌트/서버 액션에서 현재 locale을 읽는다.
 * LocaleProvider가 언어 토글 시 dflow-locale 쿠키를 기록하고 router.refresh()로
 * 서버 렌더 본문을 재요청하므로, 이 값은 클라이언트 토글과 항상 동기화된다.
 */
export async function getServerLocale(): Promise<Locale> {
  const v = (await cookies()).get('dflow-locale')?.value
  return v === 'en' ? 'en' : 'ko'
}
