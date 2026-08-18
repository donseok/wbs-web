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

function html(state: Parameters<typeof WikiSearchResults>[0]['state'], query = ''): string {
  return renderToStaticMarkup(<WikiSearchResults state={state} locale="ko" query={query} projectId="proj-1" />)
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

  it('idle 에서는 안내 패널(무엇을 찾을 수 있나)과 자리 표시만 그린다', () => {
    const out = html({ kind: 'idle' })
    expect(out).toContain('검색하면 결과가 여기에')
    expect(out).toContain('무엇을 찾을 수 있나요')
  })

  it('결과가 있으면 읽기 패널이 "고르면 읽습니다" 안내를 보여준다', () => {
    expect(html({ kind: 'done', hits: [hit], degraded: false })).toContain('결과를 고르면')
  })

  it('스니펫의 질의 토큰이 mark 로 강조된다', () => {
    const out = html({ kind: 'done', hits: [hit], degraded: false }, '발급')
    expect(out).toContain('<mark')
    expect(out).toMatch(/<mark[^>]*>발급<\/mark>/)
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

  it('제출된 query 를 스니펫에 넘겨 매칭 주변을 보여준다', () => {
    const marker = '문서시작표시어'
    const filler = '설명 '.repeat(40)
    const middleHit: SearchHit = {
      ...hit,
      content: `${marker}${filler}권한 신청 절차는 IT팀 승인 후 처리된다${filler}`,
    }
    const out = html({ kind: 'done', hits: [middleHit], degraded: false }, '권한')
    // '권한' 은 <mark> 로 감싸여 문자열이 갈라진다 — 매칭어와 후속 문장을 나눠 단언한다.
    expect(out).toMatch(/<mark[^>]*>권한<\/mark>/)
    expect(out).toContain('신청 절차는 IT팀 승인')
    expect(out).not.toContain(marker)
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

describe('WikiSearchResults 2분할 상호작용', () => {
  it('결과를 클릭하면 읽기 패널에 청크 전문과 원문 링크가 뜬다', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    const { vi } = await import('vitest')
    // 마운트 시 코퍼스 집계 GET 이 나간다 — 성공 응답으로 고정.
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ domains: [{ domain: 'minutes', docs: 3 }], total: 3 })))

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      const longHit: SearchHit = {
        ...hit,
        content: '계정 발급은 IT팀 경유로 한다. '.repeat(30).trim(),
      }
      await act(async () => {
        root.render(
          <WikiSearchResults
            state={{ kind: 'done', hits: [longHit], degraded: false }}
            locale="ko" query="발급" projectId="proj-1"
          />)
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      // 클릭 전: 읽기 패널은 안내 상태.
      expect(container.textContent).toContain('결과를 고르면')

      await act(async () => {
        container.querySelector<HTMLButtonElement>('ol li button')!.click()
      })

      // 클릭 후: 스니펫(200자)이 아니라 청크 전문이 패널에 있고, 원문 링크가 붙는다.
      expect(container.textContent).toContain('원문으로 이동')
      const panelText = container.querySelector('aside')!.textContent ?? ''
      expect(panelText.length).toBeGreaterThan(300)
      expect(panelText).toContain('정례 회의')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
