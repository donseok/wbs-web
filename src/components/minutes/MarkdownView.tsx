'use client'
import { Children, cloneElement, isValidElement, memo, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { remarkAnnotateBlocks, type BlockMarks } from '@/lib/minutes/blocks'

// mdast code 노드의 hProperties 는 <pre> 가 아니라 자식 <code> 에 떨어진다(remark-rehype 매핑 특성).
// pre 오버라이드가 이 키들을 pre/MermaidBlock 으로 "호이스팅"할 때 원본 <code> 에도 남아있으면
// data-mblock 이 두 번(래퍼+자식) 찍혀 서버 분할기와의 인덱스 파리티가 깨진다 — 그래서 호이스팅 후
// code 자식에서는 반드시 제거(이동)해야 한다.
const ANCHOR_KEYS = ['data-mblock', 'data-ins', 'data-hl', 'data-hl-count'] as const

let mermaidSeq = 0

type MermaidState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error' }

type CodeChildProps = { className?: string; children?: ReactNode } & Record<string, unknown>

function codeChildFrom(children: ReactNode): ReactElement<CodeChildProps> | null {
  const child = Children.toArray(children).find(isValidElement) as ReactElement<CodeChildProps> | undefined
  if (!child || child.type !== 'code') return null
  return child
}

function mermaidSourceFrom(child: ReactElement<CodeChildProps> | null): string | null {
  if (!child) return null
  if (!/\blanguage-mermaid\b/i.test(child.props.className ?? '')) return null
  return String(child.props.children ?? '').replace(/\n$/, '')
}

/** code 자식 props 에서 블록 앵커/마킹 data-* 만 추출 — pre/MermaidBlock 으로 호이스팅(스펙 §2.3). */
function anchorPropsFrom(child: ReactElement<CodeChildProps> | null): Record<string, unknown> {
  if (!child) return {}
  const out: Record<string, unknown> = {}
  for (const key of ANCHOR_KEYS) {
    const v = (child.props as Record<string, unknown>)[key]
    if (v !== undefined) out[key] = v
  }
  return out
}

/** 호이스팅 후 code 자식에서 앵커 data-* 를 제거한 복제본 — 중복 스탬프(pre+code) 방지. */
function stripAnchorProps(child: ReactElement<CodeChildProps>): ReactElement<CodeChildProps> {
  const clear: Record<string, undefined> = {}
  for (const key of ANCHOR_KEYS) clear[key] = undefined
  return cloneElement(child, clear)
}

function MermaidBlock({ source, anchorProps }: { source: string; anchorProps: Record<string, unknown> }) {
  const [state, setState] = useState<MermaidState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function renderDiagram() {
      setState({ status: 'loading' })
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          suppressErrorRendering: true,
          theme: 'base',
          themeVariables: {
            fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
            primaryColor: '#e3efec',
            primaryBorderColor: '#0f766e',
            primaryTextColor: '#17181d',
            lineColor: '#7a6f68',
            secondaryColor: '#fffaf4',
            tertiaryColor: '#f3ece1',
          },
        })
        const { svg } = await mermaid.render(`minute-mermaid-${++mermaidSeq}`, source)
        if (!cancelled) setState({ status: 'rendered', svg })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    void renderDiagram()
    return () => { cancelled = true }
  }, [source])

  // 앵커 속성은 세 렌더 경로 모두에 포워딩 — SSR(loading)·성공·실패 어디서든 앵커 유지(스펙 §2.3)
  if (state.status === 'rendered') {
    return (
      <div
        {...anchorProps}
        className="minutes-mermaid"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <pre {...anchorProps}>
        <code className="language-mermaid">{source}</code>
      </pre>
    )
  }
  return <div {...anchorProps} className="minutes-mermaid minutes-mermaid-loading" aria-label="Mermaid diagram loading" />
}

const components: Components = {
  a: ({ node, href, children, ...rest }) => {
    void node
    const isHash = typeof href === 'string' && href.startsWith('#')
    return isHash ? (
      <a href={href} {...rest}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>
    )
  },
  pre: ({ node, children, ...rest }) => {
    void node
    const codeChild = codeChildFrom(children)
    const anchorProps = anchorPropsFrom(codeChild)
    const source = mermaidSourceFrom(codeChild)
    if (source !== null) return <MermaidBlock source={source} anchorProps={anchorProps} />
    const strippedChildren = codeChild ? stripAnchorProps(codeChild) : children
    return <pre {...rest} {...anchorProps}>{strippedChildren}</pre>
  },
}

/** 회의록 md 렌더 — raw HTML 은 렌더하지 않음(rehype-raw 미사용, XSS 차단).
 *  marks 실변경 시에만 재파싱되도록 memo — 팝오버 개폐 등이 100k 재파싱을 유발하지 않게(스펙 §2.3). */
export const MarkdownView = memo(function MarkdownView({
  content, marks,
}: { content: string; marks?: BlockMarks }) {
  // remarkAnnotateBlocks 는 unified 어태처 시그니처(marks 를 옵션으로 받는다) —
  // 여기서 미리 호출해 트랜스포머를 넘기면 unified.freeze() 가 그 트랜스포머를
  // 인자 없이 어태처로서 재호출해 tree 가 undefined 로 들어가 터진다(런타임 버그, 브리프
  // Step 5의 "타입 불일치 시 PluggableList 명시" 대응과 함께 [attacher, options] 튜플로 전달).
  const remarkPlugins = useMemo<PluggableList>(
    () => [remarkGfm, [remarkAnnotateBlocks, marks ?? {}]],
    [marks],
  )
  return (
    <div className="minutes-md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
