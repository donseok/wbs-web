// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DegradedNotice } from '@/components/app/DegradedNotice'

/**
 * 2026-08-05 사고 가드의 표시 절반. 조회 실패가 화면에 드러나야 하고, 정상일 때는
 * 아무것도 그리지 않아야 한다(경고 피로 방지).
 */
describe('DegradedNotice', () => {
  const html = (a: boolean, p: boolean) =>
    renderToStaticMarkup(<DegradedNotice actorFailed={a} projectsFailed={p} />)

  it('둘 다 정상이면 아무것도 렌더하지 않는다', () => {
    expect(html(false, false)).toBe('')
  })

  it('권한만 실패: 권한 정보를 지목한다', () => {
    const h = html(true, false)
    expect(h).toContain('권한 정보를')
    expect(h).not.toContain('프로젝트 목록을')
    expect(h).toContain('role="alert"')
  })

  it('프로젝트 목록만 실패: 목록을 지목한다', () => {
    const h = html(false, true)
    expect(h).toContain('프로젝트 목록을')
    expect(h).not.toContain('권한 정보를')
  })

  it('둘 다 실패: 둘을 함께 지목한다', () => {
    const h = html(true, true)
    expect(h).toContain('권한과 프로젝트 목록을')
  })

  it('원인을 사용자 탓·데이터 손실로 오인시키지 않는다', () => {
    const h = html(true, true)
    expect(h).toContain('일부 정보를 불러오지 못했습니다')
    expect(h).toContain('계정이나 데이터가 바뀐 것이 아니니')
    // '프로젝트가 없습니다' 류 단정은 금지 — 그게 이번 사고의 오인 원인이었다
    expect(h).not.toContain('등록된 프로젝트 없음')
  })
})
