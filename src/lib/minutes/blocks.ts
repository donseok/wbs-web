import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { toString as mdastToString } from 'mdast-util-to-string'
import type { Root, RootContent } from 'mdast'
import type { InsightKind } from '@/lib/domain/types'

export type { InsightKind } from '@/lib/domain/types'

export interface MinuteBlock {
  index: number          // mdast 루트 children 순번 (비렌더 블록도 인덱스 차지)
  hash: string           // fnv1a64(정규화 텍스트)
  text: string           // includeHtml:false 추출 후 정규화
  rendered: boolean      // 제자리 렌더 여부 (html·footnoteDefinition·definition 은 false)
  headingDepth?: number  // heading 이면 1~6
}

// 제자리에 렌더되지 않는 mdast 루트 노드 타입 — raw HTML(rehype-raw 미사용), 각주 정의(문서 끝 이동), 링크 정의
const NON_RENDERED = new Set(['html', 'footnoteDefinition', 'definition'])

const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')

/** FNV-1a 64bit hex — 앵커 재매칭용 비암호 해시. BigInt 리터럴 금지(target ES2017). */
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * FNV_PRIME)
  }
  return h.toString(16).padStart(16, '0')
}

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

// 서버·클라이언트가 동일 파이프라인을 공유 — react-markdown 내부(remark-parse + remarkPlugins)와 같은 조합
function parseRoot(bodyMd: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(bodyMd) as Root
}

/** 본문을 mdast 루트 블록 목록으로 분할. 렌더 스탬핑·서버 검증·AI 입력·재매칭의 단일 원천. */
export function splitMinuteBlocks(bodyMd: string): MinuteBlock[] {
  if (!bodyMd.trim()) return []
  return parseRoot(bodyMd).children.map((node: RootContent, index: number) => {
    const rendered = !NON_RENDERED.has(node.type)
    const text = rendered ? normalize(mdastToString(node, { includeHtml: false })) : ''
    return {
      index,
      hash: fnv1a64(text),
      text,
      rendered,
      ...(node.type === 'heading' ? { headingDepth: node.depth } : {}),
    }
  })
}

/** 하이라이트·AI 마킹 가능 블록 — 클라 팝오버 발동/서버 토글 허용/AI 입력 포함의 공통 기준. */
export function isMarkableBlock(b: MinuteBlock): boolean {
  return b.rendered && b.text !== ''
}

/** 렌더러에 전달하는 표시 상태(인덱스 키) — 스펙 §2.1. ins 는 우선순위 최상위 1개. */
export type BlockMarks = Record<number, {
  ins?: InsightKind
  hlTier?: 1 | 2 | 3
  hlCount?: number
}>

/**
 * mdast 루트 블록에 data-* 앵커/마킹 속성을 스탬프하는 동기 remark 플러그인 — 스펙 §2.1.
 * 클래스는 절대 스탬프하지 않는다(hProperties.className 이 code 블록의 language-* 를
 * Object.assign 으로 대체하는 함정). 코드 블록의 속성은 <code> 에 떨어지며(§2 함정 2)
 * MarkdownView 의 pre 오버라이드가 pre/MermaidBlock 으로 호이스팅한다.
 */
export function remarkAnnotateBlocks(marks: BlockMarks) {
  return (tree: Root) => {
    tree.children.forEach((node: RootContent, index: number) => {
      const rendered = !NON_RENDERED.has(node.type)
      const text = rendered ? normalize(mdastToString(node, { includeHtml: false })) : ''
      if (!rendered || text === '') return  // 마킹 불가 블록은 스탬프 자체를 생략
      const props: Record<string, string | number> = { 'data-mblock': index }
      const m = marks[index]
      if (m?.ins) props['data-ins'] = m.ins
      if (m?.hlTier) {
        props['data-hl'] = m.hlTier
        props['data-hl-count'] = m.hlCount ?? 1
      }
      const data = (node.data ??= {}) as { hProperties?: Record<string, unknown> }
      data.hProperties = { ...data.hProperties, ...props }
    })
  }
}
