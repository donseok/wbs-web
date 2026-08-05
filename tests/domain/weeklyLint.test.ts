import { describe, it, expect } from 'vitest'
import {
  normalizeForCompare, lineSimilarity, lintDuplicates, lintNearDuplicates,
  lintNumbering, lintFormat, lintWeeklySheet, NEAR_DUPLICATE_THRESHOLD,
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

  it('날짜·소수·절 번호는 목록 번호로 보지 않는다', () => {
    expect(normalizeForCompare('2026.07.24 주간 회의')).toBe('2026.07.24 주간 회의')
    expect(normalizeForCompare('1.5배 성능 개선')).toBe('1.5배 성능 개선')
    expect(normalizeForCompare('1.2 개요 정리')).toBe('1.2 개요 정리')
  })

  it('공백 있는 한국식 날짜(7. 28 / 26. 7. 24.)도 번호로 보지 않는다', () => {
    expect(normalizeForCompare('7. 28(월) 정기 점검')).toBe('7. 28(월) 정기 점검')
    expect(normalizeForCompare('26. 7. 24. 주간 회의')).toBe('26. 7. 24. 주간 회의')
  })

  it('번호만 있는 줄은 비교에서 빈 줄로 본다 — 되풀이돼도 지우지 않기 위함', () => {
    expect(normalizeForCompare('1.')).toBe('')
    expect(normalizeForCompare('12)')).toBe('')
  })
})

const mkRow = (id: string, section: string, sortOrder: number, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow => ({
  id, reportId: 'rep', section, module: '', sortOrder,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

describe('lintDuplicates', () => {
  it('한 셀 안에서 되풀이된 줄 — 지적 1건, 뒤의 줄을 삭제', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료\n견적 회신\n설계 리뷰 완료' })]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('duplicate')
    expect(out[0].section).toBe('PMO')
    expect(out[0].cellKey).toBe('this_content')
    expect(out[0].rowId).toBe('r1')
    expect(out[0].edits).toEqual([{ rowId: 'r1', cellKey: 'this_content', content: '설계 리뷰 완료\n견적 회신' }])
  })

  it('구분이 다르면 같은 줄이어도 지적하지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '킥오프 완료\n설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '견적 회신\n설계 리뷰 완료' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('한 구분에 행이 여럿이면 그 행들끼리는 비교한다', () => {
    const rows = [
      mkRow('r1', '영업', 1, { thisContent: '견적 회신' }),
      mkRow('r2', '영업', 2, { thisContent: '견적 회신\n수주 협의' }),
      mkRow('r3', 'PMO', 3, { thisContent: '견적 회신' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].section).toBe('영업')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '수주 협의' }])
  })

  it('글머리·번호가 달라도 같은 줄로 본다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisIssue: '- 설계 리뷰 완료\n1. 설계  리뷰 완료' })]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits).toEqual([{ rowId: 'r1', cellKey: 'this_issue', content: '- 설계 리뷰 완료' }])
  })

  it('같은 구분이라도 열이 다르면 지적하지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료', nextContent: '설계 리뷰 완료' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('한 구분 안에서 세 번 나오면 1건으로 묶고 처음 1개만 남긴다', () => {
    const rows = [
      mkRow('r1', '영업', 1, { thisContent: '설계 리뷰 완료\n견적 회신\n설계 리뷰 완료' }),
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r1')
    expect(out[0].edits).toEqual([
      { rowId: 'r1', cellKey: 'this_content', content: '설계 리뷰 완료\n견적 회신' },
      { rowId: 'r2', cellKey: 'this_content', content: '' },
    ])
  })

  it('빈 줄은 중복으로 보지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '가\n\n나\n\n다' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('sortOrder가 뒤섞여 들어와도 앞선 행의 줄을 남긴다', () => {
    const rows = [
      mkRow('r2', '영업', 2, { thisContent: '설계 리뷰 완료' }),
      mkRow('r1', '영업', 1, { thisContent: '설계 리뷰 완료' }),
    ]
    const out = lintDuplicates(rows)
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '' }])
  })

  it('구분이 떨어져 있어도 같은 구분이면 한 묶음으로 본다', () => {
    const rows = [
      mkRow('r1', '영업', 1, { thisContent: '견적 회신' }),
      mkRow('r2', 'PMO', 2, { thisContent: '킥오프' }),
      mkRow('r3', '영업', 3, { thisContent: '견적 회신' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].section).toBe('영업')
    expect(out[0].edits).toEqual([{ rowId: 'r3', cellKey: 'this_content', content: '' }])
  })

  it('옛 시트: section이 같아도 모듈이 다르면 다른 구분이라 견주지 않는다', () => {
    const rows = [
      mkRow('r1', 'ERP', 1, { module: 'SD/LE', thisContent: '주간 회의 참석' }),
      mkRow('r2', 'ERP', 2, { module: 'MM', thisContent: '주간 회의 참석' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('옛 시트: 같은 section·같은 모듈 안에서는 견주고, 구분 이름에 모듈을 병기한다', () => {
    const rows = [
      mkRow('r1', 'ERP', 1, { module: 'MM', thisContent: '발주 검토' }),
      mkRow('r2', 'ERP', 2, { module: 'MM', thisContent: '발주 검토' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].section).toBe('ERP · MM')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '' }])
  })

  it('표준 구분명 행은 모듈이 붙어 있어도 한 구분 — PPT가 한 장으로 싣는 단위와 같다', () => {
    const rows = [
      mkRow('r1', '영업', 1, { thisContent: '견적 회신' }),
      mkRow('r2', '영업', 2, { module: '국내', thisContent: '견적 회신' }),
    ]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].section).toBe('영업')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '' }])
  })

  it('구분이 비어 있어도 이름 없는 묶음을 만들지 않는다', () => {
    const rows = [
      mkRow('r1', '', 1, { module: 'MM', thisContent: '가\n가' }),
      mkRow('r2', '', 2, { thisContent: '나\n나' }),
    ]
    expect(lintDuplicates(rows).map(f => f.section)).toEqual(['MM', '기타'])
  })

  it('들여쓴 줄(상위 항목에 딸린 상태줄)은 중복으로 보지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, {
      thisContent: '1. ERP 요구사항 정의\n - 완료\n2. MES 인터페이스 설계\n - 완료',
    })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('하위 항목이 상위와 같은 글이어도 지우지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '- 검토\n  - 검토\n- 승인' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('셀 전체가 들여쓰여 있으면 그 깊이를 기준으로 본다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '  가\n  나\n  가' })]
    expect(lintDuplicates(rows)[0].edits[0].content).toBe('  가\n  나')
  })

  it('지적문이 몇 번째 줄을 지우는지 밝힌다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '1. 주간 회의\n2. 설계 리뷰\n3. 주간 회의' })]
    const [f] = lintDuplicates(rows)
    expect(f.detail).toContain('3번째 줄')
    expect(f.detail).toContain('주간 회의')
  })

  it('줄을 지운 자리에 빈 줄 잔재를 남기지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '가\n\n가' })]
    expect(lintDuplicates(rows)[0].edits[0].content).toBe('가')
  })

  it('문단 사이 빈 줄은 지키면서 잔재만 없앤다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '가\n\n나\n\n가' })]
    expect(lintDuplicates(rows)[0].edits[0].content).toBe('가\n\n나')
  })

  it('구분마다 같은 줄이 되풀이돼도 지적은 구분별로 따로, id도 따로', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가\n가' }),
      mkRow('r2', '영업', 2, { thisContent: '가\n가' }),
    ]
    const out = lintDuplicates(rows)
    expect(out.map(f => f.section)).toEqual(['PMO', '영업'])
    expect(new Set(out.map(f => f.id)).size).toBe(2)
  })

  it('소수만 다른 두 줄이 중복으로 붙어 지워지지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '1.5배 성능 개선\n2.5배 성능 개선' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('번호만 있는 줄이 되풀이돼도 중복으로 지우지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '1.\n설계 착수\n1.\n견적 회신' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('셀 안 [머리글]로 나뉜 구획이 다르면 같은 줄이어도 지우지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n1. 이슈 도출\n\n[표준화]\n1. 이슈 도출' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('같은 구획 안에서 되풀이된 줄은 여전히 잡는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n이슈 도출\n이슈 도출' })]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits[0].content).toBe('[조업]\n이슈 도출')
  })

  it('머리글 줄 자체는 견주지 않는다 — 같은 머리글이 두 번 나와도 지우지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가\n[조업]\n나' })]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('행이 달라도 같은 이름의 구획이면 견준다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가' }),
      mkRow('r2', 'PMO', 2, { thisContent: '[조업]\n가' }),
    ]
    expect(lintDuplicates(rows)).toHaveLength(1)
  })

  it('행이 다르고 구획 이름도 다르면 견주지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가' }),
      mkRow('r2', 'PMO', 2, { thisContent: '[표준화]\n가' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('본문이 뒤따르는 대괄호는 머리글이 아니라 본문 줄이다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[참고] 확정 예정\n가\n[참고] 확정 예정' })]
    expect(lintDuplicates(rows)).toHaveLength(1)
  })

  it('머리글 아래로 항목을 들여써도 그 구획 안 중복은 잡는다 — 머리글은 들여쓰기 기준선에서 뺀다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n  1. 가\n  2. 가' })]
    const out = lintDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits[0].content).toBe('[조업]\n  1. 가')
  })

  it('구획의 마지막 항목이 지워지면 남은 머리글 껍데기도 함께 치운다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가\n[조업]\n가' })]
    expect(lintDuplicates(rows)[0].edits[0].content).toBe('[조업]\n가')
  })

  it('머리글까지 지워질 때만 그 사실을 지적문에 적는다', () => {
    const withHeader = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가\n[조업]\n가' })]
    expect(lintDuplicates(withHeader)[0].detail).toContain('구획 머리글 1줄도 함께 지웁니다')
    const plain = [mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 가' })]
    expect(lintDuplicates(plain)[0].detail).not.toContain('머리글')
  })

  it('원래부터 비어 있던 머리글은 다른 줄을 고치는 김에 지우지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가\n가\n[표준화]' })]
    expect(lintDuplicates(rows)[0].edits[0].content).toBe('[조업]\n가\n[표준화]')
  })

  it('머리글을 쓴 행과 안 쓴 행은 견주지 않는다 — 어느 영역인지 모르면 지우지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '[조업]\n가' }),
      mkRow('r2', 'PMO', 2, { thisContent: '가' }),
    ]
    expect(lintDuplicates(rows)).toEqual([])
  })

  it('들여쓴 대괄호 줄은 머리글이 아니라 딸린 줄이라 검사를 가르지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '가\n    [보류]\n가' })]
    expect(lintDuplicates(rows)).toHaveLength(1)
  })
})

describe('lineSimilarity', () => {
  it('같은 문자열은 1', () => {
    expect(lineSimilarity('설계 리뷰 완료', '설계 리뷰 완료')).toBe(1)
    expect(lineSimilarity('', '')).toBe(1)
  })

  it('1 - 편집거리/긴쪽 길이', () => {
    // 길이 4, 거리 1 → 0.75
    expect(lineSimilarity('abcd', 'abcx')).toBe(0.75)
    // 완전히 다른 문자열 → 0
    expect(lineSimilarity('abcd', 'wxyz')).toBe(0)
  })

  it('대칭이다', () => {
    expect(lineSimilarity('가나다라마바사', '가나다라마바'))
      .toBe(lineSimilarity('가나다라마바', '가나다라마바사'))
  })
})

describe('lintNearDuplicates', () => {
  // 21자 중 1자 차이 → 95% — 문턱(90%) 위. 실제 흔한 패턴(지난주 줄 복사 후 진척률만 수정).
  const A = 'ERP 인터페이스 설계 진행 중 60%'
  const B = 'ERP 인터페이스 설계 진행 중 70%'

  it('90% 이상 비슷한 두 줄을 유사 중복으로 지적한다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `${A}\n견적 회신\n${B}` })]
    const out = lintNearDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('nearDuplicate')
    expect(out[0].section).toBe('PMO')
    expect(out[0].cellKey).toBe('this_content')
  })

  it('자동 수정이 없다 — edits 는 빈 배열, 지적문에 그 사실을 밝힌다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `${A}\n${B}` })]
    const [f] = lintNearDuplicates(rows)
    expect(f.edits).toEqual([])
    expect(f.detail).toContain('자동 수정 없음')
  })

  it('지적문에 두 줄과 일치율·위치를 밝힌다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `${A}\n견적 회신\n${B}` })]
    const [f] = lintNearDuplicates(rows)
    expect(f.detail).toContain(A)
    expect(f.detail).toContain(B)
    expect(f.detail).toContain('95% 일치')
    expect(f.detail).toContain('1번째 줄과 3번째 줄')
  })

  it('완전히 같은 줄은 유사 중복이 아니다 — 규칙 ①(중복)의 몫', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `${A}\n${A}` })]
    expect(lintNearDuplicates(rows)).toEqual([])
    expect(lintDuplicates(rows)).toHaveLength(1)
  })

  it('90% 미만은 지적하지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '설계 리뷰 완료\n개발 리뷰 완료' })]
    expect(lintNearDuplicates(rows)).toEqual([])
  })

  it('글머리·번호 표기가 달라도 본문이 비슷하면 잡는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `- ${A}\n1. ${B}` })]
    expect(lintNearDuplicates(rows)).toHaveLength(1)
  })

  it('구분이 다르면 견주지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: A }),
      mkRow('r2', '영업', 2, { thisContent: B }),
    ]
    expect(lintNearDuplicates(rows)).toEqual([])
  })

  it('같은 구분이라도 열이 다르면 견주지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: A, nextContent: B })]
    expect(lintNearDuplicates(rows)).toEqual([])
  })

  it('한 구분의 여러 행을 가로질러 견주고, 이동 목표는 뒤에 등장한 행이다', () => {
    const rows = [
      mkRow('r1', '영업', 1, { thisContent: A }),
      mkRow('r2', '영업', 2, { thisContent: B }),
    ]
    const out = lintNearDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r2')
    expect(out[0].detail).toContain('2개 행에 걸쳐')
  })

  it('들여쓴 줄(상위 항목에 딸린 줄)은 견주지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `1. 항목\n - ${A}\n2. 딴 항목\n - ${B}` })]
    expect(lintNearDuplicates(rows)).toEqual([])
  })

  it('서로 비슷한 줄 여러 개는 쌍이 아니라 군집 1건으로 묶는다', () => {
    const C = 'ERP 인터페이스 설계 진행 중 80%'
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: `${A}\n${B}\n${C}` })]
    const out = lintNearDuplicates(rows)
    expect(out).toHaveLength(1)
    expect(out[0].detail).toContain('3개')
    expect(out[0].detail).toContain(A)
    expect(out[0].detail).toContain(C)
    expect(out[0].detail).toContain('1·2·3번째 줄')
  })

  it('군집이 3줄을 넘으면 앞 3줄만 인용하고 나머지는 개수로 밝힌다', () => {
    const lines = ['60%', '70%', '80%', '90%'].map(p => `ERP 인터페이스 설계 진행 중 ${p}`)
    const [f] = lintNearDuplicates([mkRow('r1', 'PMO', 1, { thisContent: lines.join('\n') })])
    expect(f.detail).toContain('4개')
    expect(f.detail).toContain('외 1줄')
  })

  it('서로 무관한 두 군집은 지적도 둘, id 도 다르다', () => {
    const rows = [mkRow('r1', 'PMO', 1, {
      thisContent: `${A}\n${B}\n7/25~8/29 통합 테스트 준비\n7/25~8/29 통합 테스트 준수`,
    })]
    const out = lintNearDuplicates(rows)
    expect(out).toHaveLength(2)
    expect(new Set(out.map(f => f.id)).size).toBe(2)
  })

  it('문턱은 정확히 90% — 딱 90%면 잡고, 그보다 낮으면 놓아준다', () => {
    // 길이 10, 거리 1(치환) → 0.9 (딱 문턱)
    const rows90 = [mkRow('r1', 'PMO', 1, { thisContent: 'abcdefghij\nabcdefghix' })]
    expect(lintNearDuplicates(rows90)).toHaveLength(1)
    expect(NEAR_DUPLICATE_THRESHOLD).toBe(0.9)
    // 길이 9, 거리 1 → 0.888…
    const rows88 = [mkRow('r1', 'PMO', 1, { thisContent: 'abcdefghi\nabcdefghx' })]
    expect(lintNearDuplicates(rows88)).toEqual([])
  })

  it('셀 안 [머리글]로 나뉜 구획이 다르면 비슷해도 견주지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, {
      thisContent: '[조업]\nERP 인터페이스 설계 진행 중 60%\n[표준화]\nERP 인터페이스 설계 진행 중 70%',
    })]
    expect(lintNearDuplicates(rows)).toEqual([])
  })

  it('구획마다 유사 쌍이 따로 있으면 지적도 구획마다 나온다 — 인용문이 같아도 id는 달라야 한다', () => {
    const rows = [mkRow('r1', 'PMO', 1, {
      thisContent: [
        '[조업]',
        'ERP 인터페이스 설계 진행 중 60%',
        'ERP 인터페이스 설계 진행 중 70%',
        '[표준화]',
        'ERP 인터페이스 설계 진행 중 60%',
        'ERP 인터페이스 설계 진행 중 70%',
      ].join('\n'),
    })]
    const out = lintNearDuplicates(rows)
    expect(out).toHaveLength(2)
    expect(new Set(out.map(f => f.id)).size).toBe(2)
  })

  it('같은 구획 안에서 비슷한 줄은 여전히 잡는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, {
      thisContent: '[조업]\nERP 인터페이스 설계 진행 중 60%\nERP 인터페이스 설계 진행 중 70%',
    })]
    expect(lintNearDuplicates(rows)).toHaveLength(1)
  })

  it('길이가 다른 딱 90% 쌍(9자↔10자 삽입)도 놓치지 않는다 — 길이 사전탈락의 부동소수점 함정', () => {
    // 거리 1(삽입), 긴쪽 10 → 0.9. |9-10|/10 > 1-0.9 꼴 비교는 부동소수점 오차로 이 쌍을 버린다.
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: 'abcdefghi\nabcdefghij' })]
    expect(lintNearDuplicates(rows)).toHaveLength(1)
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

  it(') 표기가 시트에 유일하면 보존하고, 번호 뒤 공백은 1칸으로 맞춘다', () => {
    expect(one('1) 가\n3) 나')[0].edits[0].content).toBe('1) 가\n2) 나')
    expect(one('1.가\n3.나')[0].edits[0].content).toBe('1. 가\n2. 나')
  })

  it('시트 다수결 표기로 통일한다 — 소수 표기 셀을 지적', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다\n2) 라' }),
      mkRow('r3', '구매', 3, { thisContent: '1. 마' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('numbering')
    expect(out[0].rowId).toBe('r2')
    expect(out[0].edits).toEqual([{ rowId: 'r2', cellKey: 'this_content', content: '1. 다\n2. 라' }])
    expect(out[0].detail).toContain('시트 전체')
  })

  it('동수면 . 이 이긴다 — 번호 줄 1개짜리 셀도 표기가 어긋나면 지적한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1) 가' }),
      mkRow('r2', '영업', 2, { thisContent: '1. 나' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].rowId).toBe('r1')
    expect(out[0].edits[0].content).toBe('1. 가')
  })

  it('시트에 한 표기뿐이면 그 표기를 존중한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1) 가\n2) 나' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다' }),
    ]
    expect(lintNumbering(rows)).toEqual([])
  })

  it('번호 뒤 공백을 1칸으로 맞춘다 — 없음·여러 칸·전각', () => {
    const [f] = one('1.가\n2.  나\n3.　다')
    expect(f.edits[0].content).toBe('1. 가\n2. 나\n3. 다')
    expect(f.detail).toContain('공백 → 1칸')
  })

  it('날짜·소수 줄은 고치지도, 다수결에 세지도 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '2026.07.24 주간 회의\n1.5배 성능 개선' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 다\n2) 라' }),
    ]
    expect(lintNumbering(rows)).toEqual([])
  })

  it('공백 있는 한국식 날짜(7. 28)를 순번으로 덮어쓰지 않는다', () => {
    // 다수결이 ) 여도 번호 줄 1개짜리 셀을 고치는 신규 동작이라 날짜가 위험했던 자리.
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1) 가\n2) 나' }),
      mkRow('r2', '영업', 2, { thisContent: '7. 28(월) 정기 점검 예정' }),
    ]
    expect(lintNumbering(rows)).toEqual([])
  })

  it('날짜 줄은 재부여 순번 계산에서도 빠진다', () => {
    // 1,2 뒤의 `7. 28(월)`이 항목 7로 세어지면 3으로 재부여돼 날짜가 훼손된다 — 번호 줄은 1,2뿐이어야.
    expect(one('1. 착수 보고\n2. 설계 검토\n7. 28(월) 킥오프 예정')).toEqual([])
  })

  it('번호 뒤 NBSP도 일반 공백 1칸으로 정규화한다', () => {
    const NB = '\u00A0' // HWP/Word 붙여넣기가 흘리는 NBSP — 흡수 안 하면 수정이 공백 2칸을 만든다
    const [f] = one(`1.${NB}가\n2.${NB}나`)
    expect(f.edits[0].content).toBe('1. 가\n2. 나')
    expect(f.detail).toContain('공백 → 1칸')
  })

  it('선행 0 번호는 다른 줄 수정에 휩쓸려도 보존한다', () => {
    const [f] = one('01. 가\n2.나')
    expect(f.edits[0].content).toBe('01. 가\n2. 나')
  })

  it('선행 0 번호만 있고 다른 문제 없으면 지적하지 않는다', () => {
    expect(one('01. 가\n02. 나')).toEqual([])
  })

  it('번호만 있는 줄은 건드리지 않는다', () => {
    expect(one('1.\n2.')).toEqual([])
  })

  it('체번과 표기 통일을 한 지적으로 함께 고친다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나\n3. 다' }),
      mkRow('r2', '영업', 2, { thisContent: '1) 라\n3) 마' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits[0].content).toBe('1. 라\n2. 마')
    expect(out[0].detail).toContain('1, 3')
    expect(out[0].detail).toContain('번호 표기')
  })

  it('들여쓴 번호 줄도 표기를 맞추고 들여쓰기는 보존한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '  1) 다' }),
    ]
    expect(lintNumbering(rows)[0].edits[0].content).toBe('  1. 다')
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

  it('셀 안 [머리글]로 나뉜 구획마다 번호가 1부터 다시 시작한다 — 중복 번호가 아니다', () => {
    expect(one('[조업]\n1. 가\n[표준화]\n1. 나')).toEqual([])
  })

  it('머리글 앞 구획도 독립이다', () => {
    expect(one('1. 가\n[조업]\n1. 나')).toEqual([])
  })

  it('어긋난 구획만 다시 매기고 성한 구획은 그대로 둔다', () => {
    const [f] = one('[조업]\n1. 가\n2. 나\n[표준화]\n1. 다\n3. 라')
    expect(f.edits[0].content).toBe('[조업]\n1. 가\n2. 나\n[표준화]\n1. 다\n2. 라')
    expect(f.detail).toContain('[표준화]')
    expect(f.detail).not.toContain('[조업]')
  })

  it('여러 구획이 어긋나면 구획마다 밝힌다', () => {
    const [f] = one('[조업]\n1. 가\n1. 나\n[표준화]\n1. 다\n3. 라')
    expect(f.edits[0].content).toBe('[조업]\n1. 가\n2. 나\n[표준화]\n1. 다\n2. 라')
    expect(f.detail).toContain('[조업]')
    expect(f.detail).toContain('[표준화]')
  })

  it('머리글 뒤 번호가 1로 다시 시작하지 않으면 이어 쓴 목록으로 보고 앞과 합쳐 센다', () => {
    // `[완료]`·`[8/7]` 같은 주석 표기와 담당 영역 머리글은 형태로 구별되지 않는다. 번호가 밝히게 한다.
    // 합쳐 세면 예전(구획 개념이 없던 때)과 같은 결과가 나온다 — 뒤만 떼어 1부터 덮어쓰지 않는다.
    expect(one('1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n6. 마')[0].edits[0].content)
      .toBe('1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n5. 마')
    expect(one('1. 가\n3. 나\n[완료]\n4. 다\n5. 라')[0].edits[0].content)
      .toBe('1. 가\n2. 나\n[완료]\n3. 다\n4. 라')
    expect(one('1. 가\n[8/7]\n2. 나\n[8/7]\n4. 다')[0].edits[0].content)
      .toBe('1. 가\n[8/7]\n2. 나\n[8/7]\n3. 다')
  })

  it('셀 전체로 봐서 성한 번호는 구획을 갈라도 건드리지 않는다 — 대괄호 줄이 늘 영역 머리글은 아니다', () => {
    // 잠금장치. `[완료]`·`[8/7]` 같은 주석성 표기 뒤로 번호를 이어 쓴 셀에서 3·4가 1·2로 덮어써지면
    // 되돌릴 수 없다. 구획 분할은 지적을 줄이기만 해야 한다.
    expect(one('[조업]\n1. 가\n2. 나\n[표준화]\n3. 다\n4. 라')).toEqual([])
    expect(one('1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n5. 마')).toEqual([])
    expect(one('1. 설계 검토\n[진행중]\n2. 코드 리뷰\n3. 배포')).toEqual([])
  })

  it('들여쓴 대괄호 줄은 머리글이 아니다 — 상위 목록을 갈라 번호를 덮어쓰지 않는다', () => {
    expect(one('1. 설계\n   [보류]\n2. 개발\n3. 검토')).toEqual([])
    // 상위 목록이 실제로 어긋나 있으면 들여쓴 대괄호와 무관하게 예전처럼 다시 매긴다.
    expect(one('1. 설계\n   [보류]\n2. 개발\n4. 검토')[0].edits[0].content)
      .toBe('1. 설계\n   [보류]\n2. 개발\n3. 검토')
  })

  it('떨어져 있어도 같은 이름 구획이면 한 목록으로 센다 — 중복 규칙과 같은 구획 정의', () => {
    const [f] = one('[조업]\n1. 가\n[표준화]\n1. 나\n[조업]\n1. 다')
    expect(f.edits[0].content).toBe('[조업]\n1. 가\n[표준화]\n1. 나\n[조업]\n2. 다')
    expect(f.detail).toContain('[조업] 줄 번호가 1, 1 입니다 → 1, 2')
  })

  it('지적문의 구획 라벨은 원문 표기를 그대로 쓴다', () => {
    expect(one('【조업】\n1. 가\n1. 나')[0].detail).toContain('【조업】 줄 번호가')
  })

  it('앞 목록에 오타가 있어도 주석 대괄호 뒤 번호를 1부터 덮어쓰지 않는다 — 적대적 검토 회수 케이스', () => {
    // 잠금장치(셀 전체 1..n)만으로는 못 막던 자리다. 지적이 나는 셀은 정의상 잠금이 열려 있으므로,
    // 경계 자체를 '뒤 번호가 1로 다시 시작할 때만'으로 좁혀야 이 부류가 막힌다.
    expect(one('1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n6. 마')[0].edits[0].content)
      .toBe('1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n5. 마')
    expect(one('[조업]\n1. 이슈 분석서 작성 (~8/7)\n2. As-Is 검토\n[8/7 완료]\n3. 리뷰 반영\n5. 산출물 정리')[0].edits[0].content)
      .toBe('[조업]\n1. 이슈 분석서 작성 (~8/7)\n2. As-Is 검토\n[8/7 완료]\n3. 리뷰 반영\n4. 산출물 정리')
    // 오타는 앞 구획에 있는데 뒤 구획이 덮어써지던 자리 — 뒤는 그대로 이어져야 한다.
    expect(one('1. 가\n3. 나\n[완료]\n4. 다\n5. 라')[0].edits[0].content)
      .toBe('1. 가\n2. 나\n[완료]\n3. 다\n4. 라')
  })

  it('수정을 적용하면 한 셀에 1이 둘 남지 않고 다시 지적되지도 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나\n[완료]\n3. 다\n4. 라\n6. 마' })]
    const [f] = lintNumbering(rows)
    const applied = rows.map(r => ({ ...r, thisContent: f.edits[0].content }))
    expect(lintWeeklySheet(applied)).toEqual([])
  })

  it('머리글 없는 셀은 구획 이름을 지적문에 붙이지 않는다', () => {
    expect(one('1. 가\n2. 나\n4. 다')[0].detail).toMatch(/^줄 번호가/)
  })

  it('전각 대괄호·【】도 머리글로 본다', () => {
    expect(one('【조업】\n1. 가\n［표준화］\n1. 나')).toEqual([])
  })

  it('본문이 뒤따르는 대괄호는 머리글이 아니라 본문 줄이다', () => {
    expect(one('1. 가\n[참고] 확정 예정\n3. 나')[0].edits[0].content)
      .toBe('1. 가\n[참고] 확정 예정\n2. 나')
  })

  it('표기·공백 통일은 구획과 무관하게 셀 전체에 적용한다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '1. 가\n2. 나' }),
      mkRow('r2', '영업', 2, { thisContent: '[조업]\n1) 다\n[표준화]\n1) 라' }),
    ]
    const out = lintNumbering(rows)
    expect(out).toHaveLength(1)
    expect(out[0].edits[0].content).toBe('[조업]\n1. 다\n[표준화]\n1. 라')
    expect(out[0].detail).not.toContain('줄 번호가')
  })
})

describe('lintFormat', () => {
  const one = (content: string) => lintFormat([mkRow('r1', 'PMO', 1, { thisContent: content })])

  it('줄 끝 공백·연속 공백·전각 공백은 지적하지 않는다 — 공백 점검 제외(사용자 결정)', () => {
    expect(one('가  \n나\t')).toEqual([])
    expect(one('가  나')).toEqual([])
    expect(one('가　나')).toEqual([])
  })

  it('앞뒤·연속 빈 줄도 지적하지 않는다', () => {
    expect(one('\n\n가\n\n')).toEqual([])
    expect(one('가\n\n\n\n나')).toEqual([])
  })

  it('기호를 통일할 때 그 줄의 공백은 건드리지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 나' }),
      mkRow('r2', '영업', 2, { thisContent: '· 다  라' }),
    ]
    expect(lintFormat(rows)[0].edits[0].content).toBe('- 다  라')
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

  it('글머리 기호만은 시트 전체 기준임을 지적에 밝힌다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 나' }),
      mkRow('r2', '영업', 2, { thisContent: '· 다' }),
    ]
    expect(lintFormat(rows)[0].detail).toContain('시트 전체')
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

  it('한 셀에 어긋난 기호가 여러 줄이어도 지적은 1건', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 나' }),
      mkRow('r2', '영업', 2, { thisContent: '· 다\n· 라' }),
    ]
    const out = lintFormat(rows)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('format')
    expect(out[0].edits[0].content).toBe('- 다\n- 라')
  })
})

describe('lintWeeklySheet', () => {
  it('부류 순서대로 이어붙인다 — 완전 중복 → 유사 중복 → 체번 → 정리', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, {
        thisContent: '- 설계 리뷰 완료\n- 설계 리뷰 완료',
        thisIssue: 'ERP 인터페이스 설계 진행 중 60%\nERP 인터페이스 설계 진행 중 70%',
        nextContent: '1. 가\n3. 나',
        nextIssue: '· 다',
      }),
    ]
    expect(lintWeeklySheet(rows).map(f => f.kind))
      .toEqual(['duplicate', 'nearDuplicate', 'numbering', 'format'])
  })

  it('id가 서로 겹치지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '가  \n1. 나\n3. 다\n가' }),
      mkRow('r2', '영업', 2, { thisContent: '가\n가' }),
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

  it('유사 중복만 edits 가 비고, 나머지 지적의 edits 는 비어 있지 않다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, {
        thisContent: '가  \n1. 나\n3. 다\n가',
        thisIssue: 'ERP 인터페이스 설계 진행 중 60%\nERP 인터페이스 설계 진행 중 70%',
      }),
      mkRow('r2', '영업', 2, { thisContent: '가\n가' }),
    ]
    const out = lintWeeklySheet(rows)
    expect(out.some(f => f.kind === 'nearDuplicate')).toBe(true)
    for (const f of out) {
      if (f.kind === 'nearDuplicate') expect(f.edits).toEqual([])
      else expect(f.edits.length).toBeGreaterThan(0)
    }
  })

  it('모든 지적이 자기 구분을 달고 나온다 — 제목은 열 이름만', () => {
    const rows = [mkRow('r1', '영업', 2, { thisContent: '- 가\n- 가', thisIssue: '1. 가\n3. 나', nextContent: '· 다' })]
    const out = lintWeeklySheet(rows)
    expect(out).toHaveLength(3)
    for (const f of out) expect(f.section).toBe('영업')
    expect(out.map(f => f.title)).toEqual(['금주실적 내용', '금주 이슈·이벤트', '차주계획 내용'])
  })

  it('지적 목록은 구분 순으로 나온다', () => {
    const rows = [
      mkRow('r3', '구매', 3, { thisContent: '다\n다' }),
      mkRow('r1', 'PMO', 1, { thisContent: '가\n가' }),
      mkRow('r2', '영업', 2, { thisContent: '나\n나' }),
    ]
    expect(lintWeeklySheet(rows).map(f => f.section)).toEqual(['PMO', '영업', '구매'])
  })

  it('앞 구분에 정리 지적만 있어도 구분 순서가 부류에 밀리지 않는다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '· 가' }),        // 정리(기호) 지적만
      mkRow('r2', '영업', 2, { thisContent: '- 다\n- 다' }),  // 중복 지적 + 다수결 기호(-) 공급
    ]
    const out = lintWeeklySheet(rows)
    expect(out.map(f => f.section)).toEqual(['PMO', '영업'])
  })

  it('한 구분 안에서는 중복 → 체번 → 정리 순서를 지킨다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { thisContent: '- 가\n- 가', thisIssue: '1. 가\n3. 나', nextContent: '· 다' }),
      mkRow('r2', '영업', 2, { thisContent: '· 라' }),
    ]
    const out = lintWeeklySheet(rows)
    expect(out.map(f => `${f.section}/${f.kind}`)).toEqual([
      'PMO/duplicate', 'PMO/numbering', 'PMO/format', '영업/format',
    ])
  })

  it('한 구분에 행이 여럿이면 지적도 행 순서·열 순서대로 나온다', () => {
    const rows = [
      mkRow('r1', 'PMO', 1, { nextIssue: '위\n위' }),
      mkRow('r3', 'PMO', 3, { thisContent: '아래\n아래' }),
    ]
    expect(lintWeeklySheet(rows).map(f => `${f.rowId}/${f.cellKey}`))
      .toEqual(['r1/next_issue', 'r3/this_content'])
  })

  it('실제 시트의 [조업]/[표준화] 두 구획 셀은 아무 지적도 내지 않는다', () => {
    const rows = [mkRow('r1', '조업및표준화', 7, {
      thisContent: [
        '[조업]',
        '1. 이슈 분석서 작성 (~8/7)',
        ' - As-Is 분석서 기반 이슈 도출 및 분석',
        '',
        '[표준화]',
        '1. 이슈 도출',
        ' - As-Is 분석 기반 이슈 도출',
        ' - 추가 요구사항 파악 및 필요 내용 정리',
      ].join('\n'),
    })]
    expect(lintWeeklySheet(rows)).toEqual([])
  })

  it('중복 수정을 한 번 적용하면 곧바로 다른 지적이 생기지 않는다', () => {
    const rows = [mkRow('r1', 'PMO', 1, { thisContent: '가\n\n가' })]
    const [f] = lintWeeklySheet(rows)
    const applied = rows.map(r => ({ ...r, thisContent: f.edits[0].content }))
    expect(lintWeeklySheet(applied)).toEqual([])
  })
})
