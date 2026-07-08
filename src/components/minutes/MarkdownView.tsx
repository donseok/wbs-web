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
 * 보안 — 업로드된 마크다운은 신뢰할 수 없는 사용자 콘텐츠다.
 * 아래 성질은 `tests/minutes/markdown-view.test.tsx` 가 고정한다(주석은 통제 수단이 아니다):
 * - `rehype-raw` 를 추가하지 말 것. 미추가 상태에서 raw HTML 노드는 `post()`(react-markdown
 *   내부)가 텍스트로 치환한다 — HTML 이 실행되지 않는다. 붙이는 순간 저장형 XSS 가 열린다.
 *   (실측: 붙이면 `<script>`·`<iframe>` 이 살아있는 태그로 렌더된다. on* 핸들러는
 *   hast-util-to-jsx-runtime 속성 허용목록이 어차피 떨구므로, 방어선은 "살아있는 태그 차단"이다.)
 * - 링크/이미지 URL 은 `react-markdown` 의 `defaultUrlTransform` 을 그대로 쓴다(별도 설정 불필요).
 *   허용 프로토콜은 `/^(https?|ircs?|mailto|xmpp)$/i` 뿐이고 상대경로도 허용되며, 그 외 —
 *   `javascript:`, `data:`, `vbscript:` 등 — 는 빈 문자열로 치환된다. 즉
 *   `[클릭](javascript:alert(1))` 은 설정 없이 기본값만으로 무력화된다.
 * - 이미지는 렌더링하지 않고 자리표시 텍스트만 보여준다. 결정적인 이유는 트래킹이 아니라
 *   저장 구조다: 우리는 `.md` 파일만 저장하고 그 첨부 에셋은 저장하지 않는다. 따라서
 *   `![](./img/1.png)` 같은 상대경로는 해석할 대상 자체가 없어 무엇을 하든 깨진 이미지가 된다.
 *   즉 억제(suppression)는 "동작하는 기능"과의 맞교환이 아니다 — 맞교환할 기능이 없다.
 *   실제로 로드될 수 있는 건 절대 원격 URL 뿐이고, 그건 정확히 트래킹 픽셀 케이스다:
 *   `<img src>` 는 브라우저가 즉시 원격 서버에 요청을 보내 업로드자가 아닌 *열람자*의 IP 를
 *   흘리므로, 읽음-확인 픽셀로 악용될 수 있다.
 *   alt 가 없어도 `[이미지]` 를 렌더한다 — 아무것도 안 그리면 독자는 내용이 생략된 사실조차
 *   모른 채 빈 자리만 본다.
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
  img: ({ alt }) => (
    <span className="italic text-ink-subtle">{alt ? `[이미지: ${alt}]` : '[이미지]'}</span>
  ),
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
