import { cookies } from 'next/headers'
import { registerEn, type Locale } from './dict'
import { EN } from './dict/en'

// 서버 번들에서만 EN 을 정적 등록 — 서버 렌더의 t() 는 항상 완전한 en 을 본다.
// (next/headers 의존이라 이 모듈은 클라이언트 청크에 들어갈 수 없다 = 분리 안전.)
registerEn(EN)

/**
 * 서버 컴포넌트/서버 액션에서 현재 locale을 읽는다.
 * LocaleProvider가 언어 토글 시 dflow-locale 쿠키를 기록하고 router.refresh()로
 * 서버 렌더 본문을 재요청하므로, 이 값은 클라이언트 토글과 항상 동기화된다.
 */
export async function getServerLocale(): Promise<Locale> {
  const v = (await cookies()).get('dflow-locale')?.value
  return v === 'en' ? 'en' : 'ko'
}
