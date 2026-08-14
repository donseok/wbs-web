/* 주간업무 '조업및표준화' → '조업' + '표준화' 이관의 순수 분할 규칙.
 * 이 규칙이 틀리면 운영 시트의 작성 원문이 엉뚱한 행으로 옮겨간다 — 되돌리려면 스냅샷이
 * 필요한 종류의 사고라, 실 데이터에 돌리기 전에 여기서 못박는다. */
import { describe, expect, it } from 'vitest'
import { buildSplitPlan, splitOpsCell, type SplitCells } from '../../scripts/lib/split-weekly-ops-core'

describe('splitOpsCell', () => {
  it('[조업]·[표준화] 머리글로 가르고 머리글 줄 자체는 남기지 않는다', () => {
    const cell = [
      '[조업]',
      '1. 개선정의서 작성(~8/14)',
      '  - 이슈 분석서 내용 기반 세부 개선 과제 항목 선정',
      '',
      '[표준화]',
      '1. 타사 기준정보 관리 사례 확인(8/11)',
      ' - 인터지스 iway 시스템 사례',
    ].join('\n')

    expect(splitOpsCell(cell)).toEqual({
      ops: '1. 개선정의서 작성(~8/14)\n  - 이슈 분석서 내용 기반 세부 개선 과제 항목 선정',
      standard: '1. 타사 기준정보 관리 사례 확인(8/11)\n - 인터지스 iway 시스템 사례',
    })
  })

  it('머리글이 없는 셀은 전량 조업으로 간다 — 표준화는 빈 값', () => {
    const cell = '1. MES Part 회의(7/21)\n  - 조업 AS-IS 항목별 내용 협의'
    expect(splitOpsCell(cell)).toEqual({ ops: cell, standard: '' })
  })

  it('첫 머리글 앞의 전문도 조업에 남는다 — 내용을 버리지 않는다', () => {
    const cell = '0. 공통 사항\n\n[표준화]\n1. 기준정보 정리'
    expect(splitOpsCell(cell)).toEqual({ ops: '0. 공통 사항', standard: '1. 기준정보 정리' })
  })

  it('[완료]·[8/7] 같은 다른 대괄호 줄은 경계가 아니라 내용이다 — 원문 그대로 남는다', () => {
    // weeklyLint 가 스스로 경고하듯 대괄호 한 줄이 늘 담당 영역 머리글은 아니다.
    // 조업·표준화 두 이름만 경계로 인정하고, 나머지는 지금 구획의 내용으로 둔다.
    const cell = '[조업]\n1. 출장\n[완료]\n2. 보고\n\n[표준화]\n1. 정의서'
    expect(splitOpsCell(cell)).toEqual({
      ops: '1. 출장\n[완료]\n2. 보고',
      standard: '1. 정의서',
    })
  })

  it('들여쓴 대괄호 줄은 머리글이 아니다 — 딸린 줄이 경계를 만들지 않게', () => {
    const cell = '[조업]\n1. 출장\n   [표준화]\n2. 협의'
    expect(splitOpsCell(cell)).toEqual({
      ops: '1. 출장\n   [표준화]\n2. 협의',
      standard: '',
    })
  })

  it('전각 대괄호 표기(【조업】·［표준화］)도 머리글로 본다 — HWP·Word 붙여넣기 대응', () => {
    const cell = '【조업】\n1. 가\n［표준화］\n2. 나'
    expect(splitOpsCell(cell)).toEqual({ ops: '1. 가', standard: '2. 나' })
  })

  it('앞뒤 빈 줄은 다듬되 문단 사이 빈 줄과 들여쓰기는 보존한다', () => {
    const cell = '[조업]\n\n1. 가\n\n2. 나\n\n\n[표준화]\n\n  1. 다\n'
    expect(splitOpsCell(cell)).toEqual({ ops: '1. 가\n\n2. 나', standard: '  1. 다' })
  })

  it('같은 머리글이 두 번 나오면 그 구획으로 이어붙는다', () => {
    const cell = '[조업]\n1. 가\n[표준화]\n1. 나\n[조업]\n2. 다'
    expect(splitOpsCell(cell)).toEqual({ ops: '1. 가\n2. 다', standard: '1. 나' })
  })

  it('빈 셀은 둘 다 빈 값', () => {
    expect(splitOpsCell('')).toEqual({ ops: '', standard: '' })
    expect(splitOpsCell('   \n\n  ')).toEqual({ ops: '', standard: '' })
  })

  it('머리글 이름의 공백은 접어서 본다 — [조업 ]·[ 표준화 ]도 같은 머리글', () => {
    expect(splitOpsCell('[ 조업 ]\n1. 가\n[표준화 ]\n2. 나'))
      .toEqual({ ops: '1. 가', standard: '2. 나' })
  })
})

describe('buildSplitPlan', () => {
  const row = {
    id: 'row-1',
    reportId: 'rep-1',
    weekStart: '2026-08-10',
    sortOrder: 7,
    thisContent: '[조업]\n1. 출장\n\n[표준화]\n1. 정의서',
    thisIssue: '',
    nextContent: '[조업]\n1. 협의',
    nextIssue: '[표준화]\n1. 기준 미정',
  }

  it('4셀을 각각 갈라 조업 몫과 표준화 몫을 만든다', () => {
    const [plan] = buildSplitPlan([row])
    expect(plan.ops).toEqual({
      this_content: '1. 출장', this_issue: '',
      next_content: '1. 협의', next_issue: '',
    })
    expect(plan.standard).toEqual({
      this_content: '1. 정의서', this_issue: '',
      next_content: '', next_issue: '1. 기준 미정',
    })
    expect(plan.standardIsEmpty).toBe(false)
  })

  it('머리글이 하나도 없는 행은 표준화 몫이 통째로 비어 있다고 표시한다', () => {
    const [plan] = buildSplitPlan([{ ...row, thisContent: '1. 회의', nextContent: '', nextIssue: '' }])
    expect(plan.standardIsEmpty).toBe(true)
    expect(plan.ops.this_content).toBe('1. 회의')
  })

  it('원본 4셀을 그대로 들고 있어 스냅샷 없이도 되돌릴 값을 알 수 있다', () => {
    const [plan] = buildSplitPlan([row])
    expect(plan.before).toEqual({
      this_content: row.thisContent, this_issue: row.thisIssue,
      next_content: row.nextContent, next_issue: row.nextIssue,
    })
    expect(plan.rowId).toBe('row-1')
    expect(plan.reportId).toBe('rep-1')
  })

  it('분할 전후로 글자가 늘지 않는다 — 머리글만 사라지고 내용은 옮겨질 뿐', () => {
    const [plan] = buildSplitPlan([row])
    const len = (c: SplitCells) => Object.values(c).join('').replace(/\s/g, '').length
    expect(len(plan.ops) + len(plan.standard)).toBeLessThanOrEqual(len(plan.before))
  })
})
