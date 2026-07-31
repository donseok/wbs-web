import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { LEGACY_DCUBE_PROFILE, validateProfile } from '@/lib/excel/profile'
import {
  detectWorkbook,
  pickSheets,
  detectHeaderRow,
  detectColumnHierarchy,
  detectOutlineHierarchy,
  detectLogicalColumns,
  detectTeamColumns,
} from '@/lib/excel/detect'

function makeBook(sheets: { name: string; aoa: unknown[][] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

/* ── (a) D-CUBE 3행 헤더 5팀 파일 → LEGACY_DCUBE_PROFILE 과 동등한 감지 ── */
describe('detectWorkbook — (a) D-CUBE 3행 헤더 5팀', () => {
  const wbsAoa: unknown[][] = [
    Array(17).fill(''),
    ['', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM', '', '', '', '', '', ''],
    ['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM',
      '산출물', '시작', '종료', '가중치', '', '실적%'],
    ['', '1. 준비'],
    ['', '', '1-1. 거버넌스'],
    ['', '', '', 'TFT R&R 확정', '', '', '●', '', '', '', '', '업무분장표',
      new Date(2026, 6, 1), new Date(2026, 6, 7), 2, '', 50],
    ['', '', '', '현황 파악', '', '', '', '△', '△', '●'],
    ['', '2. 실행'],
    ['', '', '2-1. 설계'],
    ['', '', '', '설계 검토', '', '', '●'],
    ['', '', '', '설계 완료', '', '', '●', '', '', '', '△'],
  ]
  const holidayAoa: unknown[][] = [['Holiday'], [new Date(2026, 6, 17), '제헌절']]
  // 'Cover' 를 WBS 보다 먼저 실어 '시트 0개 없으면 WBS 우선' 규칙(규칙 1)도 함께 검증한다.
  const buf = makeBook([
    { name: 'Cover', aoa: [['표지']] },
    { name: 'WBS', aoa: wbsAoa },
    { name: 'Holiday', aoa: holidayAoa },
  ])
  const res = detectWorkbook(buf)

  it('ok:true', () => expect(res.ok).toBe(true))
  if (!res.ok) throw new Error('unreachable')

  it('시트: Cover 가 먼저 실려도 WBS 를 고른다 + Holiday 시트 인식', () => {
    expect(res.result.sheetNames).toEqual(['Cover', 'WBS', 'Holiday'])
    expect(res.result.profile.sheetName).toBe('WBS')
    expect(res.result.profile.holidaySheetName).toBe('Holiday')
  })
  it('헤더 행 = 2 (3행 헤더의 마지막 행)', () => {
    expect(res.result.profile.headerRow).toBe(2)
  })
  it('열=계층 [1,2,3] — LEGACY_DCUBE_PROFILE 과 일치', () => {
    expect(res.result.profile.hierarchy).toEqual(LEGACY_DCUBE_PROFILE.hierarchy)
  })
  it('논리 열 좌표 — LEGACY_DCUBE_PROFILE 과 일치', () => {
    expect(res.result.profile.logical).toEqual(LEGACY_DCUBE_PROFILE.logical)
  })
  it('팀 열 — LEGACY_DCUBE_PROFILE 과 일치', () => {
    expect(res.result.profile.teamColumns).toEqual(LEGACY_DCUBE_PROFILE.teamColumns)
  })
  it('신뢰도가 전반적으로 높다', () => {
    expect(res.result.confidence.header).toBeGreaterThan(0.5)
    expect(res.result.confidence.hierarchy).toBeGreaterThan(0.9)
    expect(res.result.confidence.logical).toBeGreaterThan(0.5)
  })
  it('미리보기 — 헤더 라벨 + 데이터 10행(이하)', () => {
    expect(res.result.preview.headers[1]).toBe('Phase')
    expect(res.result.preview.rows.length).toBeLessThanOrEqual(10)
  })
  it('감지된 profile 은 validateProfile 을 통과한다', () => {
    expect(validateProfile(res.result.profile).ok).toBe(true)
  })
})

/* ── (b) 아웃라인 코드 파일(코드열 A, 이름 B, 담당 C에 팀명 직접) ── */
describe('detectWorkbook — (b) 아웃라인 + 담당 열 팀명 직접', () => {
  const aoa: unknown[][] = [
    ['코드', '업무명', '담당'],
    ['1', '준비', 'PMO'],
    ['1.1', '거버넌스 수립', 'PMO'],
    ['1.1.1', 'TFT 구성', 'ERP'],
    ['1.1.2', 'R&R 확정', 'MES'],
    ['2', '실행', 'PMO'],
    ['2.1', '설계', '가공'],
  ]
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const res = detectWorkbook(buf)

  it('ok:true, 첫(유일) 시트를 쓴다(WBS 이름 없음)', () => {
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.profile.sheetName).toBe('Sheet1')
  })
  it('아웃라인 계층 — 코드 열(0)', () => {
    if (!res.ok) return
    expect(res.result.profile.hierarchy).toEqual({ kind: 'outline', column: 0 })
  })
  it('논리 code 열 = 0', () => {
    if (!res.ok) return
    expect(res.result.profile.logical.code).toBe(0)
  })
  it("팀 열 — '담당' 열의 팀명을 직접 사용(마크 방식 아님)", () => {
    if (!res.ok) return
    expect(res.result.profile.teamColumns).toEqual([[2, '*']])
    expect(res.result.warnings).toContain('담당 열의 팀명을 직접 사용')
  })
  it('감지된 profile 은 validateProfile 을 통과한다', () => {
    if (!res.ok) return
    expect(validateProfile(res.result.profile).ok).toBe(true)
  })
})

/* ── (c) 4열 계층(B~E) 파일 → columns [1,2,3,4] ── */
describe('detectWorkbook — (c) 4열 계층', () => {
  const aoa: unknown[][] = [
    ['', 'L1', 'L2', 'L3', 'L4', '가중치'],
    ['', '1'],
    ['', '', '1.1'],
    ['', '', '', '1.1.1'],
    ['', '', '', '', '1.1.1.1', 3],
    ['', '2'],
    ['', '', '2.1'],
    ['', '', '', '2.1.1'],
    ['', '', '', '', '2.1.1.1', 5],
  ]
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const res = detectWorkbook(buf)

  it('ok:true, 열=계층 [1,2,3,4]', () => {
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.profile.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3, 4] })
  })
  it('가중치 열 = 5', () => {
    if (!res.ok) return
    expect(res.result.profile.logical.weight).toBe(5)
  })
  it('감지된 profile 은 validateProfile 을 통과한다', () => {
    if (!res.ok) return
    expect(validateProfile(res.result.profile).ok).toBe(true)
  })
})

/* ── 리뷰 픽스(2026-08-01): 짧은 별칭 부분일치 오탐 + 부분일치 warning/confidence 반영 ──
 * 두 픽스처 모두 순번 열(0)을 아웃라인 계층으로 따로 두어(값 '1'/'1.1' 등) hierarchy 폴백이
 * 'Note'/산출물 열을 가로채지 않게 한다 — 그래야 code/deliverable 판정이 실제로 규칙 5 를 거친다. */
describe('detectWorkbook — 논리 열 부분일치 리뷰 픽스', () => {
  it("'Note' 헤더가 껴 있어도 code 로 오탐하지 않고, 부분일치로 확정된 산출물 열엔 추정 warning 이 붙는다", () => {
    const aoa: unknown[][] = [
      ['순번', 'Note', '산출물명(구)', '시작', '종료'],
      ['1', '메모1', '보고서', new Date(2026, 6, 1), new Date(2026, 6, 7)],
      ['1.1', '메모2', '', new Date(2026, 6, 8), new Date(2026, 6, 9)],
      ['2', '메모3', '기획서', new Date(2026, 6, 10), new Date(2026, 6, 11)],
      ['2.1', '메모4', '', new Date(2026, 6, 12), new Date(2026, 6, 13)],
    ]
    const buf = makeBook([{ name: 'Sheet1', aoa }])
    const res = detectWorkbook(buf)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.profile.hierarchy).toEqual({ kind: 'outline', column: 0 })
    expect(res.result.profile.logical.code).toBeNull()
    expect(res.result.profile.logical.deliverable).toBe(2)
    expect(res.result.warnings).toContain("'산출물명(구)' 열을 산출물(으)로 추정했습니다 — 2단계에서 확인하세요")
    expect(res.result.warnings).toContain('코드 열을 찾지 못했습니다')
  })
  it('부분일치가 섞이면 전량 완전일치보다 confidence.logical 이 낮다', () => {
    const rows = [['1', '보고서', new Date(2026, 6, 1), new Date(2026, 6, 7)], ['1.1', '', new Date(2026, 6, 8), new Date(2026, 6, 9)]]
    const exactAoa: unknown[][] = [['순번', '산출물', '시작', '종료'], ...rows]
    const partialAoa: unknown[][] = [['순번', '산출물명(구)', '시작', '종료'], ...rows]
    const exactRes = detectWorkbook(makeBook([{ name: 'Sheet1', aoa: exactAoa }]))
    const partialRes = detectWorkbook(makeBook([{ name: 'Sheet1', aoa: partialAoa }]))
    expect(exactRes.ok && partialRes.ok).toBe(true)
    if (!exactRes.ok || !partialRes.ok) return
    expect(exactRes.result.profile.logical.deliverable).toBe(1)
    expect(partialRes.result.profile.logical.deliverable).toBe(1)
    expect(partialRes.result.confidence.logical).toBeLessThan(exactRes.result.confidence.logical)
  })
})

/* ── 리뷰 픽스(2026-08-01): ExcelProfile.logical.name — outline "코드 열+1" 관례가 무검증
 * 침묵 오독 경로였다('코드,비고,이름' 형 파일이면 비고가 이름으로 잘못 읽힌다). 이제 name 은
 * 별칭 매치를 우선 시도하고, outline 인데도 못 찾을 때만 코드+1 폴백을 쓰며 그 사실을 warning +
 * confidence 감점으로 남긴다. columns 계층은 계층 열 자체가 이름의 출처라 항상 null 로 강제한다. */
describe('detectWorkbook — logical.name(리뷰 픽스)', () => {
  it("outline + 별칭 매치 — '코드,비고,업무명' 헤더는 업무명 열(2)을 이름으로 인식(코드+1 폴백을 쓰지 않는다)", () => {
    const aoa: unknown[][] = [
      ['코드', '비고', '업무명'],
      ['1', 'x', '준비'],
      ['1.1', 'y', '거버넌스'],
      ['2', 'z', '실행'],
    ]
    const res = detectWorkbook(makeBook([{ name: 'Sheet1', aoa }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.profile.hierarchy).toEqual({ kind: 'outline', column: 0 })
    // 폴백(코드+1=1)이 아니라 별칭이 실제로 찾은 열(2)이어야 한다 — '비고'를 이름으로 오독하지 않는다.
    expect(res.result.profile.logical.name).toBe(2)
    expect(res.result.warnings.some(w => w.includes("'이름' 열을 찾지 못해"))).toBe(false)
  })

  it("outline + 별칭 미발견 — '코드,비고' 헤더는 코드 열 다음 열(1)로 폴백하고 경고+confidence 감점을 남긴다", () => {
    const aliasAoa: unknown[][] = [
      ['코드', '비고', '업무명'],
      ['1', 'x', '준비'], ['1.1', 'y', '거버넌스'], ['2', 'z', '실행'],
    ]
    const fallbackAoa: unknown[][] = [
      ['코드', '비고'],
      ['1', 'x'], ['1.1', 'y'], ['2', 'z'],
    ]
    const aliasRes = detectWorkbook(makeBook([{ name: 'Sheet1', aoa: aliasAoa }]))
    const fallbackRes = detectWorkbook(makeBook([{ name: 'Sheet1', aoa: fallbackAoa }]))
    expect(aliasRes.ok && fallbackRes.ok).toBe(true)
    if (!aliasRes.ok || !fallbackRes.ok) return
    expect(fallbackRes.result.profile.logical.name).toBe(1) // hierarchy.column(0) + 1
    expect(fallbackRes.result.warnings).toContain("'이름' 열을 찾지 못해 코드 열 다음 열로 추정했습니다 — 2단계에서 확인하세요")
    // 폴백은 부분일치와 동일한 가중치로 confidence 를 깎는다 — 별칭으로 확정된 케이스보다 낮아야 한다.
    expect(fallbackRes.result.confidence.logical).toBeLessThan(aliasRes.result.confidence.logical)
  })

  it('columns 계층은 헤더에 이름스러운 열이 있어도 항상 name:null(계층 열 자체가 이름의 출처)', () => {
    const aoa: unknown[][] = [
      ['', 'Phase', 'Task', 'Activity', '이름'],
      ['', '1. 준비'],
      ['', '', '1-1. 거버넌스'],
      ['', '', '', 'TFT 구성', '무관한값'],
    ]
    const res = detectWorkbook(makeBook([{ name: 'Sheet1', aoa }]))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.profile.hierarchy.kind).toBe('columns')
    expect(res.result.profile.logical.name).toBeNull()
  })
})

/* ── (d) 시트 0개 / 헤더 불명 ── */
describe('detectWorkbook — (d) 실패·저신뢰 경로', () => {
  it('시트 0개 → ok:false — pickSheets([]) 로 검증(§본문 참고: xlsx 라이브러리가 시트 0개 워크북의 write 자체를 거부해 실제 버퍼로 왕복 재현이 불가능함을 확인했다)', () => {
    expect(pickSheets([])).toBeNull()
  })

  it('헤더/계층 모두 불명 → ok:true, warnings + 저신뢰(침묵 폴백 아님)', () => {
    const aoa: unknown[][] = [
      ['메모'],
      ['이것은 테스트 데이터입니다'],
      ['아무 의미 없는 텍스트'],
      ['그냥 문자열'],
    ]
    const buf = makeBook([{ name: 'Sheet1', aoa }])
    const res = detectWorkbook(buf)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.warnings.length).toBeGreaterThan(0)
    expect(res.result.warnings.some(w => w.includes('헤더'))).toBe(true)
    expect(res.result.warnings.some(w => w.includes('계층'))).toBe(true)
    expect(res.result.confidence.header).toBeLessThanOrEqual(0.2)
    expect(res.result.confidence.hierarchy).toBe(0)
    expect(validateProfile(res.result.profile).ok).toBe(true)
  })
})

/* ── 규칙별 순수 함수 개별 테스트 ── */
describe('pickSheets (규칙 1)', () => {
  it('시트 0개 → null', () => expect(pickSheets([])).toBeNull())
  it("'WBS' 우선", () => {
    expect(pickSheets(['Cover', 'WBS', 'Holiday'])).toEqual({ workSheetName: 'WBS', holidaySheetName: 'Holiday' })
  })
  it("'WBS' 없으면 첫 시트, Holiday 는 이름 일치 시만", () => {
    expect(pickSheets(['Sheet1', 'Extra'])).toEqual({ workSheetName: 'Sheet1', holidaySheetName: null })
  })
})

describe('detectHeaderRow (규칙 2)', () => {
  it('별칭 히트가 가장 많은 행을 고른다', () => {
    const aoa = [['x'], ['산출물', '시작'], ['y']]
    expect(detectHeaderRow(aoa)).toEqual({ row: 1, score: 2, tie: false })
  })
  it('전부 0점이면 tie:true', () => {
    const aoa = [['x'], ['y'], ['z']]
    const r = detectHeaderRow(aoa)
    expect(r.score).toBe(0)
    expect(r.tie).toBe(true)
  })
  it('동점(0 아닌)이면 tie:true', () => {
    const aoa = [['산출물'], ['시작'], ['x']]
    const r = detectHeaderRow(aoa)
    expect(r.score).toBe(1)
    expect(r.tie).toBe(true)
  })
})

describe('detectColumnHierarchy (규칙 3)', () => {
  it('행마다 정확히 1열만 채워지는 3열 구간을 찾는다', () => {
    const dataRows: unknown[][] = [
      ['a', '', ''], ['', 'b', ''], ['', '', 'c'], ['a2', '', ''],
    ]
    expect(detectColumnHierarchy(dataRows)).toEqual({ columns: [0, 1, 2], ratio: 1 })
  })
  it('행마다 2개 이상 채워지면(구간 실패) null', () => {
    const dataRows: unknown[][] = [['a', 'b'], ['c', 'd'], ['e', 'f']]
    expect(detectColumnHierarchy(dataRows)).toBeNull()
  })
  it('데이터 없으면 null', () => expect(detectColumnHierarchy([])).toBeNull())
})

describe('detectOutlineHierarchy (규칙 4)', () => {
  it('80%+ 매치하는 첫 열을 고른다', () => {
    const dataRows: unknown[][] = [['1'], ['1.2'], ['2.3.4'], ['x'], ['3']]
    expect(detectOutlineHierarchy(dataRows)).toEqual({ column: 0, ratio: 0.8 })
  })
  it('80% 미만이면 null', () => {
    const dataRows: unknown[][] = [['1'], ['x'], ['y'], ['z']]
    expect(detectOutlineHierarchy(dataRows)).toBeNull()
  })
})

describe('detectLogicalColumns (규칙 5)', () => {
  it('완전일치로 산출물/시작/종료를 찾고 나머지는 null+warning', () => {
    const { logical, warnings } = detectLogicalColumns(['산출물', '시작', '종료'])
    expect(logical.deliverable).toBe(0)
    expect(logical.start).toBe(1)
    expect(logical.end).toBe(2)
    expect(logical.extraAxis).toBeNull()
    expect(logical.code).toBeNull()
    expect(logical.weight).toBeNull()
    expect(logical.actualPct).toBeNull()
    // name 은 이 순수 함수 레벨에서는 다른 필드와 동일하게 별칭 매치만 시도한다(outline 전용 처리·
    // 코드+1 폴백은 detectWorkbook 조립부의 책임 — 리뷰 픽스).
    expect(logical.name).toBeNull()
    expect(warnings).toHaveLength(5)
  })
  it('완전일치 실패 시 부분일치로 대체한다', () => {
    const { logical, warnings, partialMatchCount } = detectLogicalColumns(['산출물명(구)'])
    expect(logical.deliverable).toBe(0)
    expect(partialMatchCount).toBe(1)
    expect(warnings).toContain("'산출물명(구)' 열을 산출물(으)로 추정했습니다 — 2단계에서 확인하세요")
  })
  it('제외열은 후보에서 뺀다', () => {
    const { logical } = detectLogicalColumns(['산출물'], new Set([0]))
    expect(logical.deliverable).toBeNull()
  })

  // 리뷰 발견(2026-08-01): 길이 2 이하 별칭('No' 등)을 부분일치에 쓰면 무관 헤더를 code 로 오탐한다.
  it("'Note' 는 'No' 부분일치로 code 로 오탐되지 않는다", () => {
    const { logical, warnings, partialMatchCount } = detectLogicalColumns(['Note'])
    expect(logical.code).toBeNull()
    expect(partialMatchCount).toBe(0)
    expect(warnings).toContain('코드 열을 찾지 못했습니다')
  })
  it("'Nomination' 도 'No' 부분일치로 code 로 오탐되지 않는다", () => {
    const { logical, partialMatchCount } = detectLogicalColumns(['Nomination'])
    expect(logical.code).toBeNull()
    expect(partialMatchCount).toBe(0)
  })
  it('짧은 별칭(길이 2 이하)은 완전일치로는 여전히 매칭된다', () => {
    const { logical } = detectLogicalColumns(['No'])
    expect(logical.code).toBe(0)
  })
  it('부분일치 1건당 warnings 에 추정 문구를 남기고, 완전일치보다 confidence 를 낮춘다(detectWorkbook 조립부에서 검증)', () => {
    const { warnings, partialMatchCount } = detectLogicalColumns(['산출물명(구)', '시작', '종료'])
    expect(partialMatchCount).toBe(1)
    expect(warnings.filter(w => w.includes('(으)로 추정했습니다'))).toHaveLength(1)
  })
})

describe('detectTeamColumns (규칙 6)', () => {
  it('마크 방식 — DEFAULT_OWNER_MARKS 키 또는 공백뿐인 열을 팀 열로 인식', () => {
    const headerLabels = ['PMO', 'ERP']
    const dataRows: unknown[][] = [['●', '△'], ['', '●'], ['△', '']]
    expect(detectTeamColumns(headerLabels, dataRows).teamColumns).toEqual([[0, 'PMO'], [1, 'ERP']])
  })
  it("마크가 전혀 없으면(공백만) 팀 열로 인정하지 않는다(빈 스페이서 오인 방지)", () => {
    const headerLabels = ['PMO']
    const dataRows: unknown[][] = [[''], [''], ['']]
    const { teamColumns, warnings } = detectTeamColumns(headerLabels, dataRows)
    expect(teamColumns).toEqual([])
    expect(warnings).toEqual(['팀 열을 찾지 못했습니다'])
  })
  it("'담당' 열에 팀명이 직접 있으면 직접 방식으로 폴백", () => {
    const headerLabels = ['담당']
    const dataRows: unknown[][] = [['PMO'], ['ERP']]
    const { teamColumns, warnings } = detectTeamColumns(headerLabels, dataRows)
    expect(teamColumns).toEqual([[0, '*']])
    expect(warnings).toEqual(['담당 열의 팀명을 직접 사용'])
  })
  it('둘 다 없으면 빈 배열 + warning', () => {
    const headerLabels = ['X']
    const dataRows: unknown[][] = [['foo'], ['bar']]
    const { teamColumns, warnings } = detectTeamColumns(headerLabels, dataRows)
    expect(teamColumns).toEqual([])
    expect(warnings).toEqual(['팀 열을 찾지 못했습니다'])
  })
})
