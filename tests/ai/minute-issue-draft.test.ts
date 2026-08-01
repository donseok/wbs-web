import { describe, expect, it } from 'vitest'
import {
  MINUTE_ISSUE_DRAFT_BODY_MAX,
  MINUTE_ISSUE_DRAFT_CONTEXT_MAX,
  MINUTE_ISSUE_DRAFT_INSIGHT_MAX,
  MINUTE_ISSUE_DRAFT_PROCESS_REFERENCES_MAX,
  MINUTE_ISSUE_DRAFT_PROMPT_SOURCE_MAX,
  MINUTE_ISSUE_DRAFT_TITLE_MAX,
  buildFallbackMinuteIssueDraft,
  buildMinuteIssueDraft,
  buildMinuteIssueDraftPrompt,
  minuteIssueDraftLength,
  parseMinuteIssueDraftResponse,
} from '@/lib/ai/minute-issue-draft'

const VALID_BODY = [
  '[현황]',
  '- 주문 인터페이스 전환을 진행하고 있습니다.',
  '',
  '[문제/영향]',
  '- 응답 지연으로 주문 반영이 늦어지고 있습니다.',
  '',
  '[필요 조치]',
  '- 담당 팀과 재처리 방안을 검토해야 합니다.',
].join('\n')

const VALID_CLASSIFICATION = {
  megaCode: '02' as const,
  subProcess: '주문접수/등록',
}

function aiResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: '주문 인터페이스 지연',
    body: VALID_BODY,
    ...VALID_CLASSIFICATION,
    ...overrides,
  })
}

describe('parseMinuteIssueDraftResponse', () => {
  it('정확한 JSON 스키마를 정규화해 AI 초안으로 반환한다', () => {
    const raw = aiResponse({
      title: '  주문   인터페이스 지연  ',
      body: VALID_BODY.replace('[문제/영향]', '\n\n[문제/영향]'),
    })

    expect(parseMinuteIssueDraftResponse(raw)).toEqual({
      title: '주문 인터페이스 지연',
      body: VALID_BODY,
      ...VALID_CLASSIFICATION,
      mode: 'ai',
    })
  })

  it('응답 전체를 감싼 json 코드 펜스는 허용한다', () => {
    const raw = ['```json', aiResponse({ title: '전환 지연' }), '```'].join('\n')

    expect(parseMinuteIssueDraftResponse(raw)).toMatchObject({
      title: '전환 지연',
      body: VALID_BODY,
      ...VALID_CLASSIFICATION,
      mode: 'ai',
    })
  })

  it.each([
    ['설명 접두사', '결과입니다.\n' + aiResponse({ title: '제목' })],
    ['배열', JSON.stringify([JSON.parse(aiResponse({ title: '제목' }))])],
    ['추가 키', aiResponse({ title: '제목', reason: '추측' })],
    ['빈 제목', aiResponse({ title: '   ' })],
    ['본문 타입 오류', aiResponse({ title: '제목', body: 1 })],
    ['잘못된 Mega', aiResponse({ megaCode: '99' })],
    ['빈 Sub Process', aiResponse({ subProcess: '   ' })],
    ['Major Process를 넣은 Sub Process', aiResponse({ subProcess: '02.02 주문관리' })],
    ['공백 없는 Major Process를 넣은 Sub Process', aiResponse({ subProcess: '02.02주문관리' })],
    ['괄호형 Major Process를 넣은 Sub Process', aiResponse({ subProcess: '[02.02] 주문관리' })],
    ['소괄호형 Major Process를 넣은 Sub Process', aiResponse({ subProcess: '(02.02) 주문관리' })],
    ['구역 누락', aiResponse({ title: '제목', body: '[현황]\n- 진행 중' })],
    ['구역 순서 오류', aiResponse({ title: '제목',
      body: '[문제/영향]\n- 지연\n[현황]\n- 진행 중\n[필요 조치]\n- 검토',
    })],
    ['빈 구역', aiResponse({ title: '제목',
      body: '[현황]\n-\n[문제/영향]\n- 지연\n[필요 조치]\n- 검토',
    })],
    ['구역 제목이 bullet에 붙은 본문', aiResponse({ title: '제목',
      body: '[현황]\n- 진행 중[문제/영향]\n- 지연\n[필요 조치]\n- 검토',
    })],
    ['모든 구역이 빈 사실인 본문', aiResponse({ title: '제목',
      body: '[현황]\n- 원문에 명시되지 않음\n[문제/영향]\n- 원문에 명시되지 않음\n[필요 조치]\n- 원문에 명시되지 않음',
    })],
    ['깨진 JSON', '{"title":"제목",'],
  ])('%s 응답은 거부한다', (_name, raw) => {
    expect(parseMinuteIssueDraftResponse(raw)).toBeNull()
  })

  it('저장 한도 안의 충실한 제목은 자르지 않고, 초과 제목은 거부한다', () => {
    const title = '\u0000' + '가'.repeat(MINUTE_ISSUE_DRAFT_TITLE_MAX)
    const result = parseMinuteIssueDraftResponse(aiResponse({ title }))

    expect(result).not.toBeNull()
    expect(minuteIssueDraftLength(result?.title ?? '')).toBe(MINUTE_ISSUE_DRAFT_TITLE_MAX)
    expect(result?.title).toBe('가'.repeat(MINUTE_ISSUE_DRAFT_TITLE_MAX))
    expect(result?.title).not.toContain('\u0000')
    expect(parseMinuteIssueDraftResponse(aiResponse({
      title: '가'.repeat(MINUTE_ISSUE_DRAFT_TITLE_MAX + 1),
    }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({
      title: '😀'.repeat((MINUTE_ISSUE_DRAFT_TITLE_MAX / 2) + 1),
    }))).toBeNull()
  })

  it('구역당 3개 이상의 근거와 긴 완결 문장을 손실 없이 허용한다', () => {
    const detailedBody = [
      '[현황]',
      '- 첫 번째 현황',
      '- 두 번째 현황',
      '- 마지막 현황 표식 FINAL-CURRENT',
      '[문제/영향]',
      '- ' + '영향을 구체적으로 설명하는 문장'.repeat(80),
      '[필요 조치]',
      '- 첫 번째 조치',
      '- 두 번째 조치',
      '- 마지막 조치 표식 FINAL-ACTION',
    ].join('\n')

    const result = parseMinuteIssueDraftResponse(aiResponse({ body: detailedBody }))
    expect(result?.body).toBe(detailedBody)
    expect(result?.body).toContain('FINAL-CURRENT')
    expect(result?.body).toContain('FINAL-ACTION')
  })

  it('한도 초과나 생략 표식이 있는 응답은 중간을 자르지 않고 거부한다', () => {
    const oversized = [
      '[현황]',
      `- ${'가'.repeat(MINUTE_ISSUE_DRAFT_BODY_MAX)}`,
      '[문제/영향]',
      '- 영향',
      '[필요 조치]',
      '- 확인',
    ].join('\n')
    expect(parseMinuteIssueDraftResponse(aiResponse({ body: oversized }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({ title: '주문 처리...' }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({ body: VALID_BODY.replace('늦어지고', '늦어지고…') }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({ body: VALID_BODY.replace('- 담당 팀', '- [생략]\n- 담당 팀') }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({ body: VALID_BODY.replace('- 담당 팀', '- 이하 내용은 생략했습니다.\n- 담당 팀') }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({ body: VALID_BODY.replace('- 담당 팀', '- 나머지는 중략했습니다.\n- 담당 팀') }))).toBeNull()
    expect(parseMinuteIssueDraftResponse(aiResponse({
      title: '선택 입력 생략으로 주문 생성이 실패하는 문제',
    }))?.title).toContain('입력 생략')
  })
})

describe('buildFallbackMinuteIssueDraft', () => {
  it('마크다운 잡음을 지우고 원문 사실만 세 구역에 재배치한다', () => {
    const source = [
      '<!-- 내부 메모 -->',
      '# 주간 전환 회의',
      '- [ ] **ERP 인터페이스** 전환 상태를 공유했습니다.',
      '- API 응답 지연으로 주문 반영이 늦어지는 문제가 있습니다. [로그](https://example.com/log)',
      '1. 담당 팀과 재처리 방안을 검토할 필요가 있습니다.',
      '| 구분 | 상태 |',
      '| --- | --- |',
    ].join('\n')

    const result = buildFallbackMinuteIssueDraft(source)

    expect(result?.mode).toBe('fallback')
    expect(result?.title).toContain('주간 전환 회의')
    expect(result?.body).toContain('[현황]\n- 주간 전환 회의')
    expect(result?.body).toContain('[문제/영향]\n- API 응답 지연으로 주문 반영이 늦어지는 문제가 있습니다.')
    expect(result?.body).toContain('[필요 조치]\n- 담당 팀과 재처리 방안을 검토할 필요가 있습니다.')
    expect(result?.body).not.toContain('https://')
    expect(result?.body).not.toContain('**')
    expect(result?.body).not.toContain('내부 메모')
    expect(result?.body).not.toContain('영업팀이 담당')
  })

  it('현황만 있고 이슈 근거가 없는 블록은 초안으로 포장하지 않는다', () => {
    const result = buildFallbackMinuteIssueDraft([
      '프로젝트 현황을 공유했습니다.',
      '다음 회의는 월요일입니다.',
    ].join('\n'))

    expect(result).toBeNull()
  })

  it('원문에 없는 조치는 명시되지 않았다고 표시한다', () => {
    const result = buildFallbackMinuteIssueDraft([
      '프로젝트 현황을 공유했습니다.',
      '프로젝트 일정 지연 위험이 있습니다.',
    ].join('\n'))

    expect(result?.body).toBe([
      '[현황]',
      '- 프로젝트 현황을 공유했습니다.',
      '',
      '[문제/영향]',
      '- 프로젝트 일정 지연 위험이 있습니다.',
      '',
      '[필요 조치]',
      '- 원문에 명시되지 않음',
    ].join('\n'))
  })

  it('문제와 조치가 섞인 한 문장에서 조치 절도 빠짐없이 보존한다', () => {
    const source = '정산 자료 누락 문제가 있어 원본 확인이 필요합니다.'
    const result = buildFallbackMinuteIssueDraft(source)

    expect(result?.body).toContain('[현황]\n- 원문에 명시되지 않음')
    expect(result?.body).toContain(`[문제/영향]\n- ${source}`)
    expect(result?.body).toContain('[필요 조치]\n- 원본 확인이 필요합니다.')
    expect(result?.body.split(source)).toHaveLength(2)
  })

  it('문제로·누락으로·누락 시 형태 뒤의 명시된 조치도 보존한다', () => {
    for (const [source, action] of [
      ['정산 자료 누락 문제로 원본 확인이 필요합니다.', '원본 확인이 필요합니다.'],
      ['재고 누락으로 재처리가 필요합니다.', '재처리가 필요합니다.'],
      ['주문 누락 시 담당 팀 확인이 필요합니다.', '담당 팀 확인이 필요합니다.'],
    ]) {
      const result = buildFallbackMinuteIssueDraft(source)
      expect(result?.body).toContain(`[문제/영향]\n- ${source}`)
      expect(result?.body).toContain(`[필요 조치]\n- ${action}`)
    }
  })

  it('문제 설명에 포함된 확인·검토·요청 명사를 조치로 오분류하지 않는다', () => {
    for (const source of [
      '재고 확인이 불가하여 주문 처리가 지연됩니다.',
      '검토 결과 원가 오류가 확인되었습니다.',
      '요청 정보가 누락되어 처리가 불가합니다.',
    ]) {
      const result = buildFallbackMinuteIssueDraft(source)
      expect(result?.body).toContain(`[문제/영향]\n- ${source}`)
      expect(result?.body).toContain('[필요 조치]\n- 원문에 명시되지 않음')
    }
  })

  it('쉼표로 연결된 문제와 조치 절은 분리해 각각 한 번만 배치한다', () => {
    const result = buildFallbackMinuteIssueDraft(
      '재고 전송 누락으로 월 마감 집계가 지연되고 있으며, 재처리 여부 확인과 보완 협의가 필요합니다.',
    )

    expect(result?.body).toContain('[문제/영향]\n- 재고 전송 누락으로 월 마감 집계가 지연되고 있으며')
    expect(result?.body).toContain('[필요 조치]\n- 재처리 여부 확인과 보완 협의가 필요합니다.')
    expect(result?.body).not.toMatch(/재고 전송 누락[\s\S]*재고 전송 누락/)
  })

  it('한도 안의 인사이트 라벨을 자르지 않고 우선하며 같은 입력에 항상 같은 결과를 낸다', () => {
    const source = '정산 자료 누락 문제가 있어 원본을 확인할 필요가 있습니다.'
    const label = '**' + '정산 자료 보완 요청'.repeat(10) + '**'
    const first = buildFallbackMinuteIssueDraft(source, label)
    const second = buildFallbackMinuteIssueDraft(source, label)

    expect(first).toEqual(second)
    expect(first?.title.startsWith('정산 자료 보완 요청')).toBe(true)
    expect(first?.title).not.toContain('*')
    expect(first?.title).toBe('정산 자료 보완 요청'.repeat(10))
    expect(first?.title).not.toMatch(/…|\.{3,}/)
  })

  it('의미 있는 원문이 없으면 초안을 만들지 않는다', () => {
    const source = [' ', '<!-- 비공개 메모 -->', '```', '```'].join('\n')
    expect(buildFallbackMinuteIssueDraft(source)).toBeNull()
  })

  it('긴 원문의 완결 문장과 마지막 사실을 자르거나 생략하지 않는다', () => {
    const source = [
      '현황 ' + '가'.repeat(500),
      '처리 지연 문제가 ' + '나'.repeat(500),
      '담당 조직과 개선 방안을 검토할 필요가 ' + '다'.repeat(500),
    ].join('\n')
    const result = buildFallbackMinuteIssueDraft(source)
    expect(result).not.toBeNull()
    expect(minuteIssueDraftLength(result?.body ?? '')).toBeLessThanOrEqual(MINUTE_ISSUE_DRAFT_BODY_MAX)
    expect(result?.body).toContain('[현황]')
    expect(result?.body).toContain('[문제/영향]')
    expect(result?.body).toContain('[필요 조치]')
    expect(result?.body).toContain('가'.repeat(500))
    expect(result?.body).toContain('다'.repeat(500))
    expect(result?.body).not.toMatch(/…|\.{3,}/)
  })

  it('세 번째 이후의 고유 사실도 조용히 버리지 않는다', () => {
    const result = buildFallbackMinuteIssueDraft([
      '현황 첫째.',
      '현황 둘째.',
      '현황 마지막 표식 KEEP-CURRENT-3.',
      '처리 지연 문제 첫째.',
      '정보 누락 문제 둘째.',
      '업무 오류 마지막 표식 KEEP-PROBLEM-3.',
      '원인 확인이 필요합니다.',
      '개선안 검토가 필요합니다.',
      '담당자 협의 마지막 표식 KEEP-ACTION-3이 필요합니다.',
    ].join('\n'))

    expect(result?.body).toContain('KEEP-CURRENT-3')
    expect(result?.body).toContain('KEEP-PROBLEM-3')
    expect(result?.body).toContain('KEEP-ACTION-3')
  })

  it('원문의 점 생략 표식은 완결된 구두점으로 정리하고 초안에 남기지 않는다', () => {
    const result = buildFallbackMinuteIssueDraft(
      '주문 입력 오류가 반복되고... 원인 확인과 개선안 검토가 필요합니다.',
    )

    expect(result?.body).toContain('주문 입력 오류가 반복되고.')
    expect(`${result?.title}\n${result?.body}`).not.toMatch(/…|\.{3,}/)
  })

  it('독립된 생략 placeholder는 제거하되 업무상 생략 사실은 보존한다', () => {
    const result = buildFallbackMinuteIssueDraft([
      '[생략]',
      '이하 내용은 생략했습니다.',
      '나머지는 중략했습니다.',
      '선택 입력 생략으로 주문 생성 오류가 발생합니다.',
    ].join('\n'))

    expect(result?.body).toContain('선택 입력 생략으로 주문 생성 오류가 발생합니다.')
    expect(result?.body).not.toContain('[생략]')
    expect(result?.body).not.toContain('이하 내용')
    expect(result?.body).not.toContain('나머지는')
  })
})

describe('buildMinuteIssueDraft', () => {
  it('유효한 AI 응답을 우선하고 반환값에 불변 원문을 섞지 않는다', () => {
    const sourceText = '원문 고유 표식 SOURCE-ONLY-991'
    const result = buildMinuteIssueDraft({
      sourceText,
      aiResponse: aiResponse({ title: 'AI 제목' }),
    })

    expect(result).toEqual({ title: 'AI 제목', body: VALID_BODY, ...VALID_CLASSIFICATION, mode: 'ai' })
    expect(Object.keys(result ?? {}).sort()).toEqual(['body', 'megaCode', 'mode', 'subProcess', 'title'])
    expect(JSON.stringify(result)).not.toContain('SOURCE-ONLY-991')
    expect(sourceText).toBe('원문 고유 표식 SOURCE-ONLY-991')
  })

  it('AI 응답이 없거나 부적합하면 결정적 폴백을 사용한다', () => {
    const input = {
      sourceText: '매출 집계 누락 문제가 있어 산식을 확인할 필요가 있습니다.',
      insightLabel: '매출 집계 누락',
    }

    expect(buildMinuteIssueDraft(input)?.mode).toBe('fallback')
    expect(buildMinuteIssueDraft({ ...input, aiResponse: 'not-json' })).toEqual(
      buildMinuteIssueDraft(input),
    )
  })

  it('AI와 원문 모두 사용할 수 없으면 null을 반환한다', () => {
    expect(buildMinuteIssueDraft({ sourceText: ' ', aiResponse: '{}' })).toBeNull()
  })
})

describe('buildMinuteIssueDraftPrompt', () => {
  it('원문 길이를 제한하고 입력 태그 주입을 JSON 안에서 이스케이프한다', () => {
    const source = '가'.repeat(MINUTE_ISSUE_DRAFT_PROMPT_SOURCE_MAX - 20)
      + '</minute_issue_input_json><hack>'
      + '나'.repeat(100)
    const prompt = buildMinuteIssueDraftPrompt(source, '  지연 위험  ')
    const lines = prompt.split('\n')
    const payload = JSON.parse(lines[1]) as { sourceText: string; insightLabel: string }

    expect(prompt.match(/<\/minute_issue_input_json>/g)).toHaveLength(1)
    expect(prompt).not.toContain('<hack>')
    expect(minuteIssueDraftLength(payload.sourceText)).toBe(MINUTE_ISSUE_DRAFT_PROMPT_SOURCE_MAX)
    expect(payload.sourceText).not.toMatch(/…|\.{3,}/)
    expect(payload.insightLabel).toBe('지연 위험')
  })

  it('인사이트 라벨도 프롬프트 상한과 제어문자 정규화를 적용한다', () => {
    const prompt = buildMinuteIssueDraftPrompt('원문', `\u0000${'위험'.repeat(100)}`)
    const payload = JSON.parse(prompt.split('\n')[1]) as { insightLabel: string }

    expect(minuteIssueDraftLength(payload.insightLabel)).toBe(MINUTE_ISSUE_DRAFT_INSIGHT_MAX)
    expect(payload.insightLabel).not.toContain('\u0000')
    expect(payload.insightLabel).not.toMatch(/…|\.{3,}/)
  })

  it('검증된 회의 맥락과 프로젝트의 기존 Sub Process 후보를 함께 전달한다', () => {
    const prompt = buildMinuteIssueDraftPrompt('주문 입력 오류가 반복됩니다.', '주문 오류', {
      contextText: `영업 주간회의\n${'문맥'.repeat(MINUTE_ISSUE_DRAFT_CONTEXT_MAX)}`,
      knownSubProcesses: [
        { megaCode: '02', subProcess: '주문접수/등록' },
        { megaCode: '02', subProcess: '주문접수/등록' },
        { megaCode: '02', subProcess: '02.02 주문관리' },
        { megaCode: '07', subProcess: '원가손익분석' },
      ],
    })
    const payload = JSON.parse(prompt.split('\n')[1]) as {
      contextText: string
      knownSubProcesses: Array<{ megaCode: string; subProcess: string }>
    }

    expect(minuteIssueDraftLength(payload.contextText)).toBe(MINUTE_ISSUE_DRAFT_CONTEXT_MAX)
    expect(payload.contextText).not.toContain('…')
    expect(payload.knownSubProcesses).toEqual([
      { megaCode: '02', subProcess: '주문접수/등록' },
      { megaCode: '07', subProcess: '원가손익분석' },
    ])
  })

  it('기존 Sub Process 후보를 Mega별로 균형 있게 제한한다', () => {
    const knownSubProcesses = [
      ...Array.from({ length: 40 }, (_, index) => ({
        megaCode: '00' as const,
        subProcess: `기준업무-${String(index).padStart(2, '0')}`,
      })),
      ...Array.from({ length: 40 }, (_, index) => ({
        megaCode: '07' as const,
        subProcess: `원가업무-${String(index).padStart(2, '0')}`,
      })),
    ]
    const prompt = buildMinuteIssueDraftPrompt('원문', null, { knownSubProcesses })
    const payload = JSON.parse(prompt.split('\n')[1]) as {
      knownSubProcesses: Array<{ megaCode: string; subProcess: string }>
    }

    expect(payload.knownSubProcesses).toHaveLength(50)
    expect(payload.knownSubProcesses.filter(item => item.megaCode === '00')).toHaveLength(25)
    expect(payload.knownSubProcesses.filter(item => item.megaCode === '07')).toHaveLength(25)
    expect(payload.knownSubProcesses.length).toBeLessThanOrEqual(
      MINUTE_ISSUE_DRAFT_PROCESS_REFERENCES_MAX,
    )
  })
})
