import { describe, it, expect } from 'vitest'
import {
  splitMinuteBlocks, fnv1a64, isMarkableBlock, minuteBlockDraftText,
} from '@/lib/minutes/blocks'

describe('fnv1a64', () => {
  it('결정적이며 16자리 hex', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'))
    expect(fnv1a64('hello')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a64('hello')).not.toBe(fnv1a64('hello!'))
  })
  it('빈 문자열도 안정', () => {
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('splitMinuteBlocks', () => {
  it('헤딩/문단/리스트/표/코드를 루트 블록으로 분할하고 headingDepth를 기록', () => {
    const md = [
      '# 제목',
      '',
      '첫 문단입니다.',
      '',
      '- 항목 1\n- 항목 2',
      '',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '',
      '```js\nconsole.log(1)\n```',
    ].join('\n')
    const blocks = splitMinuteBlocks(md)
    expect(blocks).toHaveLength(5)
    expect(blocks[0]).toMatchObject({ index: 0, headingDepth: 1, rendered: true })
    expect(blocks[1].headingDepth).toBeUndefined()
    expect(blocks.map(b => b.index)).toEqual([0, 1, 2, 3, 4])
    // GFM 표가 하나의 블록 (remark-gfm 미적용이면 문단 여러 개로 쪼개져 실패)
    expect(blocks[3].text).toContain('a')
    expect(blocks[3].text).toContain('2')
    expect(minuteBlockDraftText(blocks[2])).toBe('항목 1\n항목 2')
    expect(minuteBlockDraftText(blocks[3])).toBe('a | b\n1 | 2')
  })

  it('목록의 anchor text/hash는 유지하면서 이슈 초안용 항목 경계만 보존한다', () => {
    const block = splitMinuteBlocks([
      '- 주문은 수기로 입력',
      '- 입력 오류와 납기 지연 발생',
      '- 자동 연계 방안 확인 필요',
    ].join('\n'))[0]

    expect(block.text).toBe('주문은 수기로 입력입력 오류와 납기 지연 발생자동 연계 방안 확인 필요')
    expect(block.hash).toBe(fnv1a64(block.text))
    expect(minuteBlockDraftText(block)).toBe([
      '주문은 수기로 입력',
      '입력 오류와 납기 지연 발생',
      '자동 연계 방안 확인 필요',
    ].join('\n'))
  })

  it('인용문과 hard break 문단도 이슈 초안용 문장 경계를 보존한다', () => {
    const blockquote = splitMinuteBlocks([
      '> 주문은 수기로 입력',
      '>',
      '> 입력 오류 발생',
      '>',
      '> 원인 확인 필요',
    ].join('\n'))[0]
    const hardBreak = splitMinuteBlocks([
      '주문은 수기로 입력  ',
      '입력 오류 발생  ',
      '원인 확인 필요',
    ].join('\n'))[0]

    expect(minuteBlockDraftText(blockquote)).toBe('주문은 수기로 입력\n입력 오류 발생\n원인 확인 필요')
    expect(minuteBlockDraftText(hardBreak)).toBe('주문은 수기로 입력\n입력 오류 발생\n원인 확인 필요')
    expect(blockquote.hash).toBe(fnv1a64(blockquote.text))
    expect(hardBreak.hash).toBe(fnv1a64(hardBreak.text))
  })

  it('체크리스트 완료 상태를 이슈 초안용 텍스트에 보존한다', () => {
    const block = splitMinuteBlocks([
      '- [x] 원인 확인 완료',
      '- [ ] 개선안 협의 필요',
    ].join('\n'))[0]

    expect(minuteBlockDraftText(block)).toBe('[완료] 원인 확인 완료\n[미완료] 개선안 협의 필요')
    expect(block.hash).toBe(fnv1a64(block.text))
  })

  it('해시는 공백 변화에 안정 (정규화: trim + 연속 공백/개행 → 스페이스 1개)', () => {
    const a = splitMinuteBlocks('결정  사항\n확정')[0]
    const b = splitMinuteBlocks('결정 사항 확정')[0]
    expect(a.hash).toBe(b.hash)
    expect(a.text).toBe('결정 사항 확정')
  })

  it('구분선(---)은 빈 텍스트 → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('위\n\n---\n\n아래')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
    expect(isMarkableBlock(blocks[0])).toBe(true)
  })

  it('raw HTML 블록은 rendered=false + 빈 텍스트(includeHtml:false) → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('문단\n\n<div>raw</div>\n\n다음')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].rendered).toBe(false)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
  })

  it('GFM 각주 정의·링크 정의는 rendered=false + 빈 텍스트 (제자리 렌더 안 됨)', () => {
    // rendered=false 블록은 text 도 '' 로 강등되므로 내용 검색이 아니라 개수·플래그로 검증
    const md = '본문[^1]과 [링크][ref]\n\n[^1]: 각주 내용\n\n[ref]: https://example.com'
    const blocks = splitMinuteBlocks(md)
    const nonRendered = blocks.filter(b => !b.rendered)
    expect(nonRendered.length).toBeGreaterThanOrEqual(2)  // footnoteDefinition + definition
    nonRendered.forEach(b => {
      expect(b.text).toBe('')
      expect(isMarkableBlock(b)).toBe(false)
    })
  })

  it('빈 문서 → 빈 배열', () => {
    expect(splitMinuteBlocks('')).toEqual([])
    expect(splitMinuteBlocks('   \n  ')).toEqual([])
  })
})
