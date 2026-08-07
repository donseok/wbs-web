import { describe, expect, it } from 'vitest'
import {
  buildWeeklyRewritePrompt, parseWeeklyRewriteResponse, type WeeklyRewritePromptCell,
} from '@/lib/ai/weekly-rewrite'
import { WEEKLY_CELL_MAX } from '@/lib/domain/weeklySheet'

const source: WeeklyRewritePromptCell[] = [
  {
    id: 'c0',
    section: '영업',
    field: '금주실적 내용',
    content: 'ERP-21 전환을 2026-08-07까지 80% 완료함',
  },
  {
    id: 'c1',
    section: '품질',
    field: '금주 이슈·이벤트',
    content: '담당: qa@example.com, 근거 https://example.com/runbook',
  },
]

const response = (cells: unknown = [
  { id: 'c0', content: 'ERP-21 전환을 2026-08-07까지 80% 완료했습니다.' },
  { id: 'c1', content: '담당자는 qa@example.com이며, 근거는 https://example.com/runbook 입니다.' },
]) => JSON.stringify({ cells })

describe('주간업무 AI 재작성 응답', () => {
  it('프롬프트를 손실 없는 JSON 데이터로 만든다', () => {
    expect(JSON.parse(buildWeeklyRewritePrompt(source))).toEqual({ cells: source })
  })

  it('정확한 셀 집합을 같은 순서로 반환하고 공백·CRLF를 정규화한다', () => {
    const raw = response([
      { id: 'c0', content: '  ERP-21 전환을 2026-08-07까지 80% 완료했습니다.  ' },
      { id: 'c1', content: '담당자는 qa@example.com이며,\r\n근거는 https://example.com/runbook 입니다.' },
    ])
    expect(parseWeeklyRewriteResponse(raw, source)).toEqual([
      { id: 'c0', content: 'ERP-21 전환을 2026-08-07까지 80% 완료했습니다.' },
      { id: 'c1', content: '담당자는 qa@example.com이며,\n근거는 https://example.com/runbook 입니다.' },
    ])
  })

  it('응답 전체를 감싼 JSON 코드 펜스는 허용한다', () => {
    expect(parseWeeklyRewriteResponse(`\`\`\`json\n${response()}\n\`\`\``, source)).toHaveLength(2)
  })

  it.each([
    ['설명 접두사', `결과입니다.\n${response()}`],
    ['루트 추가 키', JSON.stringify({ cells: JSON.parse(response()).cells, note: '설명' })],
    ['셀 추가 키', response([
      { id: 'c0', content: source[0].content, note: '설명' },
      { id: 'c1', content: source[1].content },
    ])],
    ['셀 누락', response([{ id: 'c0', content: source[0].content }])],
    ['순서 변경', response([
      { id: 'c1', content: source[1].content },
      { id: 'c0', content: source[0].content },
    ])],
    ['ID 변경', response([
      { id: 'other', content: source[0].content },
      { id: 'c1', content: source[1].content },
    ])],
    ['빈 결과', response([
      { id: 'c0', content: '   ' },
      { id: 'c1', content: source[1].content },
    ])],
    ['길이 초과', response([
      { id: 'c0', content: `${source[0].content}${'가'.repeat(WEEKLY_CELL_MAX)}` },
      { id: 'c1', content: source[1].content },
    ])],
    ['깨진 JSON', '{"cells":['],
  ])('%s 응답은 거부한다', (_name, raw) => {
    expect(parseWeeklyRewriteResponse(raw, source)).toBeNull()
  })

  it.each([
    ['코드', '전환을 2026-08-07까지 80% 완료했습니다.'],
    ['날짜', 'ERP-21 전환을 금요일까지 80% 완료했습니다.'],
    ['수치', 'ERP-21 전환을 2026-08-07까지 완료했습니다.'],
    ['이메일', '담당자를 확인했으며, 근거는 https://example.com/runbook 입니다.'],
    ['URL', '담당자는 qa@example.com입니다.'],
  ])('%s 토큰이 사라진 결과는 거부한다', (kind, content) => {
    const cells = kind === '이메일' || kind === 'URL'
      ? [{ id: 'c0', content: source[0].content }, { id: 'c1', content }]
      : [{ id: 'c0', content }, { id: 'c1', content: source[1].content }]
    expect(parseWeeklyRewriteResponse(response(cells), source)).toBeNull()
  })

  it('기존 토큰을 포함한 다른 값으로 바꾸거나 반복 횟수를 줄인 결과도 거부한다', () => {
    expect(parseWeeklyRewriteResponse(response([
      { id: 'c0', content: 'ERP-210 전환을 2026-08-07까지 180% 완료했습니다.' },
      { id: 'c1', content: source[1].content },
    ]), source)).toBeNull()

    const repeated = [{ ...source[0], content: 'ERP-21 점검 2건, ERP-21 검증 2건 완료' }]
    expect(parseWeeklyRewriteResponse(JSON.stringify({ cells: [
      { id: 'c0', content: 'ERP-21 점검과 검증 2건 완료' },
    ] }), repeated)).toBeNull()
  })
})
