import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '@/components/minutes/MarkdownView'

/**
 * 회의록 본문은 신뢰할 수 없는 사용자 업로드 콘텐츠다. 이 파일은 MarkdownView 의
 * 보안 성질을 *고정*한다 — 주석은 통제 수단이 아니기 때문이다.
 *
 * 가장 유력한 미래 회귀: 누군가 인라인 `<br>` 을 살리려고 `rehype-raw` 를 붙인다.
 * 그 순간 아래 XSS 테스트가 빨갛게 죽어야 한다.
 *
 * `environment: 'node'` (vitest.config.ts 기본값) 에서 돈다 — renderToStaticMarkup 은
 * DOM 이 필요 없다. jsdom 도크블록을 넣지 말 것.
 */

const render = (md: string) => renderToStaticMarkup(<MarkdownView content={md} />)

/**
 * 출력에서 *살아있는* HTML 태그만 뽑는다.
 * 이스케이프된 텍스트에는 리터럴 `<`/`>` 가 없으므로(`&lt;`/`&gt;`) 이 정규식에 걸리지 않는다.
 * 단순 부분문자열 검사로는 안 된다 — `&lt;img src=x onerror=alert(1)&gt;` 라는 *무해한 텍스트*가
 * " onerror=" 를 포함하기 때문에 통과/실패를 구분하지 못한다.
 */
const liveTags = (html: string) => html.match(/<[^>]+>/g) ?? []

describe('MarkdownView — raw HTML 무력화 (rehype-raw 금지)', () => {
  it('<script> 는 살아있는 태그가 아니라 이스케이프된 텍스트로 나온다', () => {
    const html = render(`본문\n\n<script>alert(1)</script>\n`)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(liveTags(html).some((t) => /^<script/i.test(t))).toBe(false)
  })

  it('<img onerror> 는 살아있는 태그도, onerror 속성도 만들지 않는다', () => {
    const html = render(`본문\n\n<img src=x onerror=alert(1)>\n`)
    // 이스케이프된 텍스트 안에 "onerror" 라는 *글자*는 남지만, 속성으로는 존재하지 않는다.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(liveTags(html).some((t) => /^<img/i.test(t))).toBe(false)
    expect(liveTags(html).some((t) => /onerror/i.test(t))).toBe(false)
  })

  it('<iframe> 는 살아있는 태그로 렌더되지 않는다', () => {
    // rehype-raw 회귀 시 실제로 살아나는 벡터. on* 핸들러는 hast-util-to-jsx-runtime 의
    // 속성 허용목록이 어차피 떨궈서 "on* 없음" 단언은 이빨이 없다 — 살아있는 태그 자체를 막는다.
    const html = render('<iframe src="https://attacker.example/"></iframe>')
    expect(html).toContain('&lt;iframe')
    expect(liveTags(html).some((t) => /^<iframe/i.test(t))).toBe(false)
  })
})

describe('MarkdownView — urlTransform 기본값이 위험 스킴을 차단한다', () => {
  it('javascript: 링크는 href="" 로 무력화된다', () => {
    const html = render('[클릭](javascript:alert(1))')
    expect(html).toContain('href=""')
    expect(html).not.toContain('javascript:')
  })

  it('data: 링크는 href="" 로 무력화된다', () => {
    const html = render('[클릭](data:text/html,<script>alert(1)</script>)')
    expect(html).toContain('href=""')
    expect(html).not.toContain('data:text/html')
  })
})

describe('MarkdownView — 링크 하드닝', () => {
  it('정상 https 링크는 살아남고 target/rel 하드닝이 붙는다', () => {
    const html = render('[예시](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })
})

describe('MarkdownView — 이미지 억제', () => {
  it('alt 가 있으면 자리표시 텍스트에 alt 를 담고, <img> 는 만들지 않는다', () => {
    const html = render('![다이어그램](https://attacker.example/pixel.png)')
    expect(html).toContain('[이미지: 다이어그램]')
    expect(liveTags(html).some((t) => /^<img/i.test(t))).toBe(false)
    // 원격 URL 이 출력 어디에도 남으면 안 된다 — 남으면 열람자 IP 가 새는 요청이 된다.
    expect(html).not.toContain('attacker.example')
  })

  it('alt 가 없어도 조용히 사라지지 않고 [이미지] 를 렌더한다', () => {
    const html = render('![](./img/1.png)')
    expect(html).toContain('[이미지]')
    expect(liveTags(html).some((t) => /^<img/i.test(t))).toBe(false)
  })
})

describe('MarkdownView — remark-gfm 이 실제로 연결되어 있다', () => {
  it('GFM 표가 <table> 로 렌더된다', () => {
    const html = render(['| 항목 | 담당 |', '| --- | --- |', '| A | 홍길동 |'].join('\n'))
    expect(html).toContain('<table>')
    expect(html).toContain('<th>항목</th>')
    expect(html).toContain('<td>홍길동</td>')
  })
})
