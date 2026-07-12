import { unified, type Plugin } from 'unified'
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
const U64 = BigInt(64)

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

// remarkAnnotateBlocks 는 Task 4 에서 이 파일에 추가된다 (BlockMarks 포함).
export type { Plugin }
