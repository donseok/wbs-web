import { describe, expect, it } from 'vitest'
import { snippetOf, stripLeadingMeta, toSearchViewState } from '@/lib/domain/searchView'

const hit = {
  domain: 'minutes', entityType: 'minute', entityId: 'm1',
  title: '정례 회의', content: '계정 발급은 IT팀 경유로 한다',
  href: '/p/x/minutes/m1', occurredOn: '2026-07-14', score: 0.9, matchedBy: ['vector'],
}

describe('toSearchViewState', () => {
  it('200 이면 결과와 degraded 를 그대로 옮긴다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: false } })
    expect(state).toMatchObject({ kind: 'done', degraded: false })
    if (state.kind !== 'done') throw new Error('done 이어야 한다')
    expect(state.hits[0].entityId).toBe('m1')
  })

  it('degraded 를 잃지 않는다 — 조용히 품질을 떨어뜨리면 안 된다', () => {
    const state = toSearchViewState({ ok: true, status: 200, body: { results: [hit], degraded: true } })
    expect(state).toMatchObject({ kind: 'done', degraded: true })
  })

  it('503 은 error 다 — 결과 없음으로 위장하지 않는다', () => {
    expect(toSearchViewState({ ok: false, status: 503, body: { error: 'VECTOR_SEARCH_FAILED' } }))
      .toEqual({ kind: 'error' })
  })

  it('403 도 error 다', () => {
    expect(toSearchViewState({ ok: false, status: 403, body: { error: 'PROJECT_FORBIDDEN' } }))
      .toEqual({ kind: 'error' })
  })

  it('200 인데 본문 형태가 깨졌으면 error 다 — 빈 결과로 넘기지 않는다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: null })).toEqual({ kind: 'error' })
    expect(toSearchViewState({ ok: true, status: 200, body: { results: 'nope' } })).toEqual({ kind: 'error' })
  })

  it('결과 0건은 정상 done 이다', () => {
    expect(toSearchViewState({ ok: true, status: 200, body: { results: [], degraded: false } }))
      .toEqual({ kind: 'done', hits: [], degraded: false })
  })
})

describe('snippetOf', () => {
  const withHeader = '# 회의록 OMS 설명\n일자: 2026-08-06\n팀: MES\n계정 발급은 IT팀 경유로 한다'

  it('선두의 헤더·메타 줄을 걷어낸다', () => {
    expect(snippetOf(withHeader)).toBe('계정 발급은 IT팀 경유로 한다')
  })

  it('본문 중간의 헤더는 그대로 둔다 — 선두 블록만 걷어낸다', () => {
    const content = '# 회의록 OMS 설명\n일자: 2026-08-06\n본문 시작\n## 소제목\n이어지는 내용'
    expect(snippetOf(content)).toBe('본문 시작 ## 소제목 이어지는 내용')
  })

  it('전부 헤더·메타 뿐이면 원본을 접어 폴백한다', () => {
    const metaOnly = '# 회의록 OMS 설명\n일자: 2026-08-06\n팀: MES'
    expect(snippetOf(metaOnly)).toBe('# 회의록 OMS 설명 일자: 2026-08-06 팀: MES')
  })

  it('maxChars 로 자른다', () => {
    const long = 'a'.repeat(300)
    const snippet = snippetOf(long, 200)
    expect(snippet).toHaveLength(200)
  })

  it('연속 공백·개행을 한 칸으로 접는다', () => {
    expect(snippetOf('본문   여러\n\n  공백이   섞였다')).toBe('본문 여러 공백이 섞였다')
  })
})

describe('snippetOf — query 매칭 중심', () => {
  // 청크 앞부분만 자르면 질의어가 중간에 있을 때 무관한 도입부만 보인다(운영 체감:
  // "답변 내용이 부족하다"). marker 는 청크 맨 앞에만 있는 고유 표식이라, 창이 중간부터
  // 시작하면 반드시 빠진다.
  const marker = '문서시작표시어'
  const filler = '설명 '.repeat(40)
  const content = `${marker}${filler}권한 신청 절차는 IT팀 승인 후 처리된다${filler}`

  it('질의 토큰 주변을 창으로 잘라 보여준다 — 도입부가 아니라 관련 문장', () => {
    const snippet = snippetOf(content, 200, '권한')
    expect(snippet).toContain('권한 신청 절차는 IT팀 승인')
    expect(snippet).not.toContain(marker)
  })

  it('창이 중간에서 시작하면 앞에 … 를 붙인다', () => {
    expect(snippetOf(content, 200, '권한').startsWith('…')).toBe(true)
  })

  it('매칭이 없으면 기존처럼 앞부분을 자른다', () => {
    expect(snippetOf(content, 200, '존재하지않는토큰')).toBe(snippetOf(content, 200))
  })
})

describe('stripLeadingMeta', () => {
  it('헤더 뒤에 수평선만 남은 청크는 빈 문자열로 판정한다 — 폴백 없이', () => {
    // 운영 실측: chunk 1 이 "# OMS 설명 2026.08.06 09시07분\n\n---" 형태였다.
    expect(stripLeadingMeta('# OMS 설명 2026.08.06 09시07분\n\n---')).toBe('')
  })

  it('본문이 있으면 걷어내고 본문을 반환한다', () => {
    expect(stripLeadingMeta('# 회의록 OMS 설명\n일자: 2026-08-06\n실제 논의 내용')).toBe('실제 논의 내용')
  })
})
