// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '@/components/minutes/MarkdownView'
import { splitMinuteBlocks, type BlockMarks } from '@/lib/minutes/blocks'

function stampedIndexes(html: string): number[] {
  return [...html.matchAll(/data-mblock="(\d+)"/g)].map(m => Number(m[1])).sort((a, b) => a - b)
}

const RICH_MD = [
  '# 제목',
  '',
  '첫 문단입니다.',
  '',
  '<div>raw html — 렌더 안 됨</div>',
  '',
  '- 리스트 항목',
  '',
  '```mermaid\ngraph TD; A-->B\n```',
  '',
  '```js\nconsole.log(1)\n```',
  '',
  '| a | b |\n|---|---|\n| 1 | 2 |',
  '',
  '본문[^1]',
  '',
  '[^1]: 각주 정의',
].join('\n')

describe('stamp parity — splitMinuteBlocks ↔ MarkdownView DOM', () => {
  it('마킹 가능 블록의 인덱스 집합이 서버 분할기와 정확히 일치', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const expected = blocks.filter(b => b.rendered && b.text !== '').map(b => b.index)
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} />)
    expect(stampedIndexes(html)).toEqual(expected)
  })

  it('marks 부여 — data-ins/data-hl/data-hl-count 속성이 해당 블록에 스탬프', () => {
    const marks: BlockMarks = { 1: { ins: 'decision' }, 3: { hlTier: 2, hlCount: 3 } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    expect(html).toMatch(/data-mblock="1"[^>]*data-ins="decision"|data-ins="decision"[^>]*data-mblock="1"/)
    expect(html).toContain('data-hl="2"')
    expect(html).toContain('data-hl-count="3"')
  })

  it('마킹된 mermaid 블록 — language-mermaid 클래스 보존 + 래퍼에 data-mblock 호이스팅', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const mermaidIdx = blocks.findIndex(b => b.text.includes('graph TD'))
    const marks: BlockMarks = { [mermaidIdx]: { hlTier: 1, hlCount: 1 } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    // SSR 은 MermaidBlock loading 경로 — 래퍼 div 에 앵커 속성이 호이스팅돼야 함
    const wrapper = html.match(/<div[^>]*minutes-mermaid-loading[^>]*>/)?.[0] ?? ''
    expect(wrapper).toContain(`data-mblock="${mermaidIdx}"`)
    expect(wrapper).toContain('data-hl="1"')
  })

  it('마킹된 일반 코드 블록 — pre 에 호이스팅 + language-js 보존', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const codeIdx = blocks.findIndex(b => b.text.includes('console.log'))
    const marks: BlockMarks = { [codeIdx]: { ins: 'action' } }
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} marks={marks} />)
    const pre = html.match(/<pre[^>]*>/g)?.find(p => p.includes('data-mblock')) ?? ''
    expect(pre).toContain(`data-mblock="${codeIdx}"`)
    expect(pre).toContain('data-ins="action"')
    expect(html).toContain('language-js')  // className 클로버 없음
  })

  it('raw HTML·각주 정의 블록은 DOM 에 data-mblock 없음(비렌더)', () => {
    const blocks = splitMinuteBlocks(RICH_MD)
    const nonRendered = blocks.filter(b => !b.rendered).map(b => b.index)
    const html = renderToStaticMarkup(<MarkdownView content={RICH_MD} />)
    const stamped = stampedIndexes(html)
    nonRendered.forEach(i => expect(stamped).not.toContain(i))
  })
})
