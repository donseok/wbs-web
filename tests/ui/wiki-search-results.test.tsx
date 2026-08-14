// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WikiSearchResults } from '@/components/wiki/WikiSearchResults'
import type { SearchHit } from '@/lib/domain/searchView'

const hit: SearchHit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '계정 발급은 IT팀 경유로 한다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}

function html(state: Parameters<typeof WikiSearchResults>[0]['state']): string {
  return renderToStaticMarkup(<WikiSearchResults state={state} locale="ko" />)
}

describe('WikiSearchResults', () => {
  it('결과와 출처 배지를 보여준다', () => {
    const out = html({ kind: 'done', hits: [hit], degraded: false })
    expect(out).toContain('정례 회의')
    expect(out).toContain('회의록')
    expect(out).toContain('/p/x/minutes/m1')
  })

  it('degraded 를 조용히 넘기지 않고 알린다', () => {
    expect(html({ kind: 'done', hits: [hit], degraded: true })).toContain('어휘 검색만')
  })

  it('검색 실패를 결과 없음으로 위장하지 않는다', () => {
    const out = html({ kind: 'error' })
    expect(out).toContain('불러오지 못했습니다')
    expect(out).not.toContain('결과가 없습니다')
  })

  it('결과 0건이면 그렇게 말한다', () => {
    expect(html({ kind: 'done', hits: [], degraded: false })).toContain('결과가 없습니다')
  })

  it('idle 에서는 아무것도 렌더하지 않는다 — 안내는 셸(WikiSearch)이 맡는다', () => {
    expect(html({ kind: 'idle' })).toBe('')
  })

  it('loading 에서는 확인 중이라고 알린다 — 빈 화면을 고장으로 오인하지 않게', () => {
    expect(html({ kind: 'loading' })).toContain('확인하는 중')
  })

  it('스니펫에서 메타데이터 헤더가 사라진다', () => {
    const headerHit: SearchHit = {
      ...hit,
      content: '# 회의록 OMS 설명\n일자: 2026-08-06\n팀: MES\n실제 논의 내용이 여기 있다',
    }
    const out = html({ kind: 'done', hits: [headerHit], degraded: false })
    expect(out).not.toContain('# 회의록')
    expect(out).toContain('실제 논의 내용이 여기 있다')
  })

  it('이슈 출처는 이슈 배지로 나온다', () => {
    const out = html({ kind: 'done', degraded: false, hits: [{ ...hit, domain: 'issues', entityType: 'issue' }] })
    expect(out).toContain('이슈')
  })

  it('불릿 [n] 과 근거 버튼 [n] 이 같은 문서를 순서대로 가리킨다', () => {
    const hitB: SearchHit = {
      ...hit, entityId: 'm2', title: '두 번째 회의', href: '/p/x/minutes/m2', content: '다른 논의 내용',
    }
    const out = html({ kind: 'done', degraded: false, hits: [hit, hitB] })
    // 불릿 [1] 이 [2] 보다 먼저 나오고, 그 순서가 근거 버튼의 href 순서와 같다
    // (둘 다 같은 hits 배열·같은 index 로 렌더하므로 항상 1:1 대응한다).
    expect(out.indexOf('[1]')).toBeLessThan(out.indexOf('[2]'))
    expect(out.indexOf(hit.href)).toBeLessThan(out.indexOf(hitB.href))
  })
})
