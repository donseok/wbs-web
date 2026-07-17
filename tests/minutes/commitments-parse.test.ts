import { describe, expect, it } from 'vitest'
import {
  commitmentContextHash,
  isValidIsoDate,
  parseCommitmentItems,
} from '@/lib/ai/minutes-commitments'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'

describe('parseCommitmentItems', () => {
  it('서두·코드펜스를 제거하고 같은 목록 블록의 서로 다른 약속을 모두 유지한다', () => {
    const blocks = splitMinuteBlocks(`- ERP 김철수 책임이 API 명세를 2026-07-20까지 확정한다.
- MES 박영희가 통합 테스트를 2026-07-22까지 완료한다.`)
    const raw = `다음과 같습니다.\n\`\`\`json
${JSON.stringify([
  {
    i: 0,
    commitment: 'API 명세 확정',
    sourceQuote: 'ERP 김철수 책임이 API 명세를 2026-07-20까지 확정한다.',
    ownerName: '김철수',
    ownerTeam: 'ERP',
    dueText: '2026-07-20',
    dueDate: '2026-07-20',
  },
  {
    i: 0,
    commitmentText: '통합 테스트 완료',
    sourceQuote: 'MES 박영희가 통합 테스트를 2026-07-22까지 완료한다.',
    ownerName: '박영희',
    ownerTeam: 'MES',
    dueText: '2026-07-22',
    dueDate: '2026-07-22',
  },
])}
\`\`\``

    const out = parseCommitmentItems(raw, blocks, '2026-07-17')!
    expect(out).toHaveLength(2)
    expect(out.map(x => x.commitmentText)).toEqual(['API 명세 확정', '통합 테스트 완료'])
    expect(out[0]).toMatchObject({
      i: 0,
      ownerName: '김철수',
      ownerTeam: 'ERP',
      dueText: '2026-07-20',
      dueDate: '2026-07-20',
    })
    expect(out[0].commitmentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(out[0].commitmentHash).not.toBe(out[1].commitmentHash)
  })

  it('같은 항목은 중복 제거하지만 항목 캡은 유효 결과 기준으로 적용한다', () => {
    const body = Array.from({ length: 35 }, (_, i) => `작업 ${i}를 완료한다.`).join('\n\n')
    const blocks = splitMinuteBlocks(body)
    const candidates = blocks.map((block, i) => ({
      i,
      commitmentText: `작업 ${i} 완료`,
      sourceQuote: block.text,
      ownerName: null,
      ownerTeam: null,
      dueText: null,
      dueDate: null,
    }))
    candidates.splice(1, 0, { ...candidates[0] })

    const out = parseCommitmentItems(JSON.stringify(candidates), blocks, '2026-07-17')!
    expect(out).toHaveLength(30)
    expect(new Set(out.map(x => x.commitmentHash)).size).toBe(30)
    expect(out[0].commitmentText).toBe('작업 0 완료')
    expect(out[1].commitmentText).toBe('작업 1 완료')
  })

  it('sourceQuote가 원문에 없으면 항목을 버린다', () => {
    const blocks = splitMinuteBlocks('MES 김영희가 품질 점검을 7월 말까지 완료한다.')
    const raw = JSON.stringify([{
      i: 0,
      commitmentText: '품질 점검',
      sourceQuote: '원문에 없는 근거',
      ownerName: '김영희',
      ownerTeam: 'MES',
      dueText: '7월 말',
      dueDate: '2026-07-31',
    }])
    expect(parseCommitmentItems(raw, blocks, '2026-07-17')).toEqual([])
  })

  it('선택 필드에 원문 근거가 없으면 추측하지 않고 null로 내린다', () => {
    const blocks = splitMinuteBlocks('MES 김영희가 품질 점검을 7월 말까지 완료한다.')
    const raw = JSON.stringify([{
      i: 0,
      commitmentText: '품질 점검',
      sourceQuote: 'MES 김영희가 품질 점검을 7월 말까지 완료한다.',
      ownerName: '박철수',
      ownerTeam: 'PMO',
      dueText: '다음 주',
      dueDate: '2026-07-31',
    }])

    expect(parseCommitmentItems(raw, blocks, '2026-07-17')![0]).toMatchObject({
      ownerName: null,
      ownerTeam: null,
      dueText: null,
      dueDate: null,
    })
  })

  it('잘못된 블록·비렌더 블록·길이 초과 항목을 버린다', () => {
    const blocks = splitMinuteBlocks('유효한 약속\n\n<div>숨겨진 약속</div>')
    const base = {
      commitmentText: '유효한 약속',
      sourceQuote: '유효한 약속',
      ownerName: null,
      ownerTeam: null,
      dueText: null,
      dueDate: null,
    }
    const raw = JSON.stringify([
      { i: 99, ...base },
      { i: 1, ...base },
      { i: 0, ...base, commitmentText: 'x'.repeat(241) },
      { i: 0, ...base },
    ])
    expect(parseCommitmentItems(raw, blocks, '2026-07-17')?.map(x => x.commitmentText))
      .toEqual(['유효한 약속'])
  })

  it('실제 달력에 없는 dueDate는 null이지만 근거 dueText는 유지한다', () => {
    const blocks = splitMinuteBlocks('2월 말까지 완료한다.')
    const make = (commitmentText: string, dueDate: string) => ({
      i: 0,
      commitmentText,
      sourceQuote: '2월 말까지 완료한다.',
      ownerName: null,
      ownerTeam: null,
      dueText: '2월 말',
      dueDate,
    })
    const out = parseCommitmentItems(JSON.stringify([
      make('윤년 완료', '2024-02-29'),
      make('평년 잘못된 날짜', '2026-02-29'),
      make('잘못된 월 끝', '2026-04-31'),
    ]), blocks, '2026-02-01')!

    expect(out.map(x => x.dueDate)).toEqual(['2024-02-29', null, null])
    expect(out.every(x => x.dueText === '2월 말')).toBe(true)
  })

  it('깨진 JSON·배열이 아닌 JSON·잘못된 회의일은 null을 반환한다', () => {
    const blocks = splitMinuteBlocks('작업 완료')
    expect(parseCommitmentItems('[{"i":0,', blocks, '2026-07-17')).toBeNull()
    expect(parseCommitmentItems('{"i":0}', blocks, '2026-07-17')).toBeNull()
    expect(parseCommitmentItems('[]', blocks, '2026-02-29')).toBeNull()
  })
})

describe('isValidIsoDate', () => {
  it('형식·윤년·월별 마지막 날을 검증한다', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2000-02-29')).toBe(true)
    expect(isValidIsoDate('1900-02-29')).toBe(false)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-04-31')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-7-01')).toBe(false)
    expect(isValidIsoDate('0000-01-01')).toBe(false)
  })
})

describe('commitmentContextHash', () => {
  it('같은 컨텍스트에서 결정적이고 본문·회의일 변경을 모두 감지한다', () => {
    const hash = commitmentContextHash('회의록 본문', '2026-07-17')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(commitmentContextHash('회의록 본문', '2026-07-17')).toBe(hash)
    expect(commitmentContextHash('회의록 본문 수정', '2026-07-17')).not.toBe(hash)
    expect(commitmentContextHash('회의록 본문', '2026-07-18')).not.toBe(hash)
  })
})
