import { NextResponse } from 'next/server'

/**
 * 라우트 핸들러 공용 에러 응답 — 사본 3벌 정리(issue-analysis · minutes/export · chat/v2).
 * 에러 응답은 캐시되면 안 되므로 no-store 고정.
 *
 * 에이전트 외부 API 계열(src/lib/agent/externalApi.ts 의 apiFail(status, code, error) 등)과는
 * 인자 순서가 반대지만 통합하지 않는다 — 그쪽은 계약 v2.1 이 code 문자열(unauthorized ·
 * validation_failed · insufficient_scope …)을 외부 러너와의 약속으로 못 박아 code 가 필수이고,
 * 여기 code 는 선택이다(캐시 헤더도 그쪽엔 없다). 한 시그니처로 합치면 둘 중 한쪽 계약이 깨진다.
 */
export function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json(
    { error, ...(code ? { code } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}
