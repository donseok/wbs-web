// i18n 사전 진입점 — KO 는 정적, EN 은 지연 등록(registry).
//
// 왜 이렇게 갈랐나(2026-08-18 성능 감사): 종전에는 ko+en 전체 병합 DICT 를 이 모듈이
// 정적으로 들고 있어, t 를 임포트하는 모든 클라이언트 컴포넌트를 따라 사전 전체
// (~51KB gz)가 전 페이지 공통 청크에 실렸다. 사용자 대부분이 ko 이므로 en 절반은
// 죽은 무게다. 지금은:
//   - 클라이언트: KO 만 정적. en 은 LocaleProvider 가 ensureEnLoaded() 로 필요할 때만
//     동적 import(별도 청크). 로드 전 en 조회는 ko 로 폴백된다.
//   - 서버: server.ts 가 EN 을 정적 import 해 registerEn() 으로 등록 — 서버 렌더는
//     항상 완전한 en 을 쓴다(서버 번들 크기는 체감 비용이 아니다).
// 주의: 클라이언트 코드에서 './dict/en' 을 정적 import 하면 분리가 무효가 된다.
import { KO } from './dict/ko'

export type Locale = 'ko' | 'en'
export type DictKey = keyof typeof KO

let EN: Record<string, string> | null = null

/** 서버 전용(server.ts) — EN 테이블을 동기 등록한다. */
export function registerEn(table: Record<DictKey, string>): void {
  EN = table
}

/** 클라이언트 — EN 청크를 지연 로드해 등록한다. 중복 호출은 no-op. */
export async function ensureEnLoaded(): Promise<void> {
  if (EN) return
  const m = await import('./dict/en')
  EN = m.EN
}

export function isEnLoaded(): boolean {
  return EN !== null
}

/** 번역 조회 — locale 이 en 인데 아직 미로드면 ko 로 폴백한다(로드 완료 시 재렌더로 교체). */
export function t(locale: Locale, key: DictKey): string {
  const table = locale === 'en' ? EN : (KO as Record<string, string>)
  return table?.[key] ?? (KO as Record<string, string>)[key] ?? key
}
