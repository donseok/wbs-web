'use client'
import { Children, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

let mermaidSeq = 0

type MermaidState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error' }

function mermaidSourceFrom(children: ReactNode): string | null {
  const child = Children.toArray(children).find(isValidElement) as ReactElement<{
    className?: string
    children?: ReactNode
  }> | undefined
  if (!child || child.type !== 'code') return null
  if (!/\blanguage-mermaid\b/i.test(child.props.className ?? '')) return null
  return String(child.props.children ?? '').replace(/\n$/, '')
}

function MermaidBlock({ source }: { source: string }) {
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

  if (state.status === 'rendered') {
    return (
      <div
        className="minutes-mermaid"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    )
  }
  return <div className="minutes-mermaid minutes-mermaid-loading" aria-label="Mermaid diagram loading" />
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
    const source = mermaidSourceFrom(children)
    if (source) return <MermaidBlock source={source} />
    return <pre {...rest}>{children}</pre>
  },
}

/** 회의록 md 렌더 — raw HTML 은 렌더하지 않음(rehype-raw 미사용, XSS 차단). */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="minutes-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
