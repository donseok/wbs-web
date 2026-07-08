import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

/**
 * 회의록 마크다운 렌더러 — 서버 컴포넌트(RSC), `'use client'` 없음.
 *
 * 렌더링에 상태·이벤트·effect 가 전혀 필요 없다(문서를 그리기만 한다). `react-markdown` v10 의
 * `Markdown`(동기, `runSync` 기반)은 훅을 쓰지 않는 순수 함수이므로 서버에서 그대로 실행되고,
 * `remark-gfm`(동기 remark 플러그인)과 함께 파서 전체가 서버 번들에만 남는다 — 클라이언트로
 * 내려가는 JS 는 0 (async 훅 버전인 `MarkdownHooks` 만 `useEffect`/`useState` 를 쓴다; 여긴 미사용).
 *
 * 이 파일이 `react-markdown`/`remark-gfm` 을 정적 import 하는 유일한 파일이다.
 *
 * 보안 — 업로드된 마크다운은 신뢰할 수 없는 사용자 콘텐츠다:
 * - `rehype-raw` 를 추가하지 말 것. 미추가 상태에서 raw HTML 노드는 `post()`(react-markdown
 *   내부)가 텍스트로 치환한다 — HTML 이 실행되지 않는다. 붙이는 순간 저장형 XSS 가 열린다.
 * - 링크/이미지 URL 은 `react-markdown` 의 `defaultUrlTransform` 을 그대로 쓴다(별도 설정 불필요).
 *   허용 프로토콜은 `/^(https?|ircs?|mailto|xmpp)$/i` 뿐이고 상대경로도 허용되며, 그 외 —
 *   `javascript:`, `data:`, `vbscript:` 등 — 는 빈 문자열로 치환된다. 즉
 *   `[클릭](javascript:alert(1))` 은 설정 없이 기본값만으로 무력화된다.
 * - 이미지는 렌더링하지 않고 alt 텍스트만 보여준다. `<img src>` 는 브라우저가 즉시 원격 서버에
 *   요청을 보내므로, 업로드자가 아닌 열람자의 IP 를 그 서버에 흘리는 읽음-확인/트래킹 픽셀로
 *   악용될 수 있다 — 렌더를 막는 쪽이 안전하고 구현도 더 간단하다.
 * - `a` 오버라이드는 `href`/`title`/`children` 만 명시적으로 골라 쓴다. react-markdown 은 커스텀
 *   컴포넌트에 항상 `node`(hast 엘리먼트) prop 을 얹어 보내는데(`passNode: true` 고정), 이를
 *   `{...rest}` 로 통째로 실제 DOM `<a>` 에 스프레드하면 알 수 없는 prop 경고가 뜬다.
 */

const components: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ alt }) =>
    alt ? <span className="italic text-ink-subtle">[이미지: {alt}]</span> : null,
}

export function MarkdownView({ content }: { content: string }) {
  return (
    <article className="prose-minutes">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </article>
  )
}
