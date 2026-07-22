import { describe, it, expect } from 'vitest'
import {
  normalizeForCompare, lintDuplicates, lintNumbering, lintFormat, lintWeeklySheet,
} from '@/lib/domain/weeklyLint'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

describe('normalizeForCompare', () => {
  it('앞뒤 공백·연속 공백을 정리한다', () => {
    expect(normalizeForCompare('  설계  리뷰 완료  ')).toBe('설계 리뷰 완료')
  })

  it('선두 글머리 기호를 떼어낸다', () => {
    expect(normalizeForCompare('- 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('· 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('● 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('* 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('선두 줄 번호를 떼어낸다 — . 과 ) 양식 모두', () => {
    expect(normalizeForCompare('1. 설계 리뷰 완료')).toBe('설계 리뷰 완료')
    expect(normalizeForCompare('12) 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('기호와 번호가 겹쳐 있어도 둘 다 떼어낸다', () => {
    expect(normalizeForCompare('- 1. 설계 리뷰 완료')).toBe('설계 리뷰 완료')
  })

  it('전각 공백을 반각으로 바꾼다', () => {
    expect(normalizeForCompare('설계　리뷰')).toBe('설계 리뷰')
  })

  it('빈 줄·기호만 있는 줄은 빈 문자열', () => {
    expect(normalizeForCompare('')).toBe('')
    expect(normalizeForCompare('   ')).toBe('')
    expect(normalizeForCompare('-')).toBe('')
  })
})

const mkRow = (id: string, section: string, sortOrder: number, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id, reportId: 'rep', section, module: '', sortOrder,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('lintDuplicates', () => {
  it('같은 열 두 구분에 동일 줄 — 지적 1건, 뒤 구분에서 삭제', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '킥오프 완료\n설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '견적 회신\n설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('duplicate')
    expect(out[0].cellKey).toBe('this_content')
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '견적 회신' }])
  })

  it('글머리·번호가 달라도 같은 줄로 본다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisIssue: '- 설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisIssue: '1. 설계  리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_issue', content: '' }])
  })

  it('다른 열의 같은 줄은 지적하지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { nextContent: '설계 리뷰 완료' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('같은 셀 안 중복은 이 규칙의 대상이 아니다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료\n설계 리뷰 완료' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('3개 구분에 겹치면 1건으로 묶고 첫 구분만 남긴다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료\n견적 회신' }),
      mkRow('r3', '구매', 3, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([
      { rowId: 'r2', cellKey: 'this_content', content: '견적 회신' },
      { rowId: 'r3', cellKey: 'this_content', content: '' },
    ])
  })

  it('빈 줄은 중복으로 보지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가\n\n나' }),
      mkRow('r2', '영업', 2, { thisContent: '다\n\n라' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('sortOrder가 뒤섞여 들어와도 가장 작은 구분을 남긴다', () => {
    const rows = [
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료' }),
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '' }])
  })
})

describe('lintNumbering', () => {
  const one = (content: string) => lintNumbering([mkRow('r1', 'PMO', 1, { thisContent: content })])

  it('건너뛴 번호(1,2,4)를 다시 매긴다', () => {
    const out = one('1. 가\n2. 나\n4. 다')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('numbering')
    expect(out[0].rowId).toBe('r1')
    expect(out[0].cellKey).toBe('this_content')
    expect(out[0].edits).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '1. 가\n2. 나\n3. 다' }])
    expect(out[0].detail).toContain('1, 2, 4')
    expect(out[0].detail).toContain('1, 2, 3')
  })

  it('중복 번호(1,2,2)를 다시 매긴다', () => {
    expect(one('1. 가\n2. 나\n2. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('1이 아닌 시작(2,3,4)을 1부터 다시 매긴다', () => {
    expect(one('2. 가\n3. 나\n4. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('역순(3,2,1)을 순서는 그대로 두고 번호만 다시 매긴다', () => {
    expect(one('3. 가\n2. 나\n1. 다')[0].edits[0].content).toBe('1. 가\n2. 나\n3. 다')
  })

  it('올바른 번호는 지적하지 않는다', () => {
    expect(one('1. 가\n2. 나\n3. 다')).toEqual([])
  })

  it('번호 줄이 1개뿐이면 지적하지 않는다', () => {
    expect(one('1. 가\n나\n다')).toEqual([])
  })

  it('번호가 없으면 지적하지 않는다', () => {
    expect(one('- 가\n- 나')).toEqual([])
  })

  it(') 스타일과 구분자 뒤 공백을 보존한다', () => {
    expect(one('1) 가\n3) 나')[0].edits[0].content).toBe('1) 가\n2) 나')
    expect(one('1.가\n3.나')[0].edits[0].content).toBe('1.가\n2.나')
  })

  it('번호 없는 줄은 순서를 유지하고 번호도 소비하지 않는다', () => {
    expect(one('1. 가\n메모\n3. 나')[0].edits[0].content).toBe('1. 가\n메모\n2. 나')
  })

  it('줄 앞 들여쓰기를 보존한다', () => {
    expect(one('  1. 가\n  3. 나')[0].edits[0].content).toBe('  1. 가\n  2. 나')
  })

  it('4개 열을 모두 검사한다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { nextIssue: '1. 가\n3. 나' })]
    expect(lintNumbering(rows)[0].cellKey).toBe('next_issue')
  })
})

describe('lintFormat', () => {
  const one = (content: string) => lintFormat([mkRow('r1', 'PMO', 1, { thisContent: content })])
  const fixed = (content: string) => one(content)[0].edits[0].content

  it('줄 끝 공백을 지운다', () => {
    expect(fixed('가  \n나\t')).toBe('가\n나')
  })

  it('줄 안 연속 공백을 1칸으로 접는다', () => {
    expect(fixed('가  나')).toBe('가 나')
  })

  it('들여쓰기는 접지 않는다', () => {
    expect(one('  가')).toEqual([])
  })

  it('전각 공백을 반각으로 바꾼다', () => {
    expect(fixed('가　나')).toBe('가 나')
  })

  it('앞뒤 빈 줄을 지운다', () => {
    expect(fixed('\n\n가\n\n')).toBe('가')
  })

  it('중간 연속 빈 줄을 1줄로 줄인다', () => {
    expect(fixed('가\n\n\n\n나')).toBe('가\n\n나')
  })

  it('고칠 것이 없으면 지적하지 않는다', () => {
    expect(one('가\n\n나')).toEqual([])
  })

  it('글머리 기호를 시트 전체 다수결로 통일한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 나' }),
      mkRow('r2', '영업', 2, { thisContent: '· 다' }),
    ]
    const out = lintFormat(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits[0].content).toBe('- 다')
    expect(out[0].detail).toContain('글머리 기호')
  })

  it('동수면 - 가 이긴다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '· 가' }),
      mkRow('r2', '영업', 2, { thisContent: '- 나' }),
    ]
    expect(lintFormat(rows)[0].edits[0].content).toBe('- 가')
  })

  it('시트 전체에 기호가 한 종류뿐이면 기호는 건드리지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '· 가\n· 나' })]
    expect(lintFormat(rows)).toEqual([])
  })

  it('기호 뒤에 공백이 없으면 글머리로 보지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가' }),
      mkRow('r2', '영업', 2, { thisContent: '·5% 감소' }),
    ]
    expect(lintFormat(rows)).toEqual([])
  })

  it('셀 하나에 문제가 여러 개여도 지적은 1건', () => {
    const out = one('가  \n\n\n나 ')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('format')
    expect(out[0].edits[0].content).toBe('가\n\n나')
  })
})

describe('lintWeeklySheet', () => {
  it('부류 순서대로 이어붙인다 — 중복 → 체번 → 정리', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료', nextContent: '다  ' }),
    ]
    expect(lintWeeklySheet(rows).map(f => f.kind)).toEqual(['duplicate', 'numbering', 'format'])
  })

  it('id가 서로 겹치지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가  \n1. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '가' }),
    ]
    const ids = lintWeeklySheet(rows).map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('깨끗한 시트는 빈 배열', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가\n나' }),
      mkRow('r2', '영업', 2, { thisContent: '다' }),
    ]
    expect(lintWeeklySheet(rows)).toEqual([])
  })

  it('모든 지적의 edits는 비어 있지 않다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가  \n1. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '가' }),
    ]
    for (const f of lintWeeklySheet(rows)) expect(f.edits.length).toBeGreaterThan(0)
  })
})
