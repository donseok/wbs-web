'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 회의록 md 렌더 — raw HTML 은 렌더하지 않음(rehype-raw 미사용, XSS 차단). */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="minutes-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
