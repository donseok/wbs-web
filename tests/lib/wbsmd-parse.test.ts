import { describe, expect, it } from 'vitest'
import { parseWbsMarkdown, validateWbsDoc, toImportNodes, nextBusinessDay } from '@/lib/wbsmd/parse'

/** N단 wbs.md TS 파서 — 스킬 파서(wbs-nlevel-parse.py)와 동일 계약(스펙 §import 계약 v2.2).
 *  웹 업로드 경로(미리보기+적용)가 이 파서를 쓴다. 케이스는 python 테스트에서 포팅. */

const PL_MD = `---
project: MES
module: mes-qa
attach: PH-03/SYS-QA

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }

credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
---

# WBS — MES 품질

<!-- 주석은
     여러 줄이어도 무시된다 -->

## SUB-QA-JD: 판정

### WP-QA-JD-PR: 프로세스
- [ ] TSK-QA-JD-PR-01: 품질 자동판정 프로세스   @홍길동  w:5  ~2026-12-19
  - category: dev
  - domain: backend
  - priority: critical
  - tags: qa, judge
  - depends: TSK-QA-JD-PR-02
  - prd-ref: program:QA-JD-001
  - requirements: 시험 실적을 기준과 대조해 자동 판정한다.
  - acceptance: 룰 테이블 기반 / 판정 이력 전건 보존
  - [ ] STK-QA-JD-PR-01-1: 판정 룰 테이블 설계 리뷰
  - [x] STK-QA-JD-PR-01-2: 등급 하향 규칙 케이스 정리
- [ ] TSK-QA-JD-PR-02: 재판정 처리 프로세스   w:3  ~2026-12-26  credit:if  if-id:IF-0041
- [M] TSK-QA-JD-PR-90: 판정 오픈 점검   ~2027-01-09
`

describe('parseWbsMarkdown', () => {
  const doc = parseWbsMarkdown(PL_MD)
  it('frontmatter — module·attach·levels 7층·credits', () => {
    expect(doc.front.module).toBe('mes-qa')
    expect(doc.front.attach).toBe('PH-03/SYS-QA')
    expect(doc.levels).toHaveLength(7)
    expect(doc.levels[6]).toMatchObject({ prefix: 'STK', progress: 'checklist', upload: 'fold' })
    expect(Object.keys(doc.front.credits)).toEqual(['default', 'if'])
  })
  it('노드 — 접두어로 level, 헤딩/들여쓰기로 부모', () => {
    const byId = new Map(doc.nodes.map(n => [n.id, n]))
    expect(byId.get('SUB-QA-JD')).toMatchObject({ level: 2, parent: null })
    expect(byId.get('WP-QA-JD-PR')).toMatchObject({ level: 3, parent: 'SUB-QA-JD' })
    expect(byId.get('TSK-QA-JD-PR-01')).toMatchObject({ level: 5, parent: 'WP-QA-JD-PR' })
    expect(byId.get('STK-QA-JD-PR-01-1')).toMatchObject({ level: 6, parent: 'TSK-QA-JD-PR-01' })
  })
  it('토큰 — @담당·w:·~날짜·credit:·if-id:', () => {
    const t1 = doc.nodes.find(n => n.id === 'TSK-QA-JD-PR-01')!
    expect(t1.tokens).toMatchObject({ assignee: '홍길동', weight: '5', end: '2026-12-19' })
    const t2 = doc.nodes.find(n => n.id === 'TSK-QA-JD-PR-02')!
    expect(t2.tokens).toMatchObject({ credit: 'if', if_id: 'IF-0041' })
  })
  it('마일스톤 [M] + checklist [x]', () => {
    expect(doc.nodes.find(n => n.id === 'TSK-QA-JD-PR-90')!.milestone).toBe(true)
    expect(doc.nodes.find(n => n.id === 'STK-QA-JD-PR-01-2')!.checked).toBe(true)
  })
  it('마일스톤 ID 누락은 problems 로', () => {
    const bad = parseWbsMarkdown(PL_MD.replace('- [M] TSK-QA-JD-PR-90: 판정 오픈 점검   ~2027-01-09', '- [M] 판정 오픈 점검   ~2027-01-09'))
    expect(bad.problems.some(p => p.includes('마일스톤'))).toBe(true)
  })
})

describe('validateWbsDoc', () => {
  it('정상 PL 파일 통과', () => {
    const r = validateWbsDoc(parseWbsMarkdown(PL_MD), 'pl')
    expect(r.errors).toEqual([])
    expect(r.counts).toMatchObject({ Subsystem: 1, WP: 1, Task: 3, SubTask: 2 })
  })
  it('PL 본문의 골격 층(PH·SYS) → 에러', () => {
    const bad = PL_MD.replace('## SUB-QA-JD: 판정', '## PH-03: 구축\n\n## SUB-QA-JD: 판정')
    expect(validateWbsDoc(parseWbsMarkdown(bad), 'pl').errors.some(e => e.includes('골격'))).toBe(true)
  })
  it('미선언 접두어·순번 역행·ID 중복 → 에러', () => {
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('## SUB-QA-JD', '## ZZZ-JD')), 'pl')
      .errors.some(e => e.includes('접두어'))).toBe(true)
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('### WP-QA-JD-PR: 프로세스', '### SUB-QA-XX: 역행')), 'pl')
      .errors.some(e => e.includes('순번'))).toBe(true)
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('TSK-QA-JD-PR-02: 재판정', 'TSK-QA-JD-PR-01: 재판정')), 'pl')
      .errors.some(e => e.includes('중복'))).toBe(true)
  })
  it('input 층의 [x] · 실적 % → 에러', () => {
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('- [ ] TSK-QA-JD-PR-02', '- [x] TSK-QA-JD-PR-02')), 'pl')
      .errors.some(e => e.includes('[ ]'))).toBe(true)
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('재판정 처리 프로세스', '재판정 처리 30%')), 'pl')
      .errors.some(e => e.includes('%'))).toBe(true)
  })
  it('attach 없는 PL → 에러 / rollup leaf·depends 미해결은 경고', () => {
    expect(validateWbsDoc(parseWbsMarkdown(PL_MD.replace('attach: PH-03/SYS-QA\n', '')), 'pl')
      .errors.some(e => e.includes('attach'))).toBe(true)
    const w = validateWbsDoc(parseWbsMarkdown(PL_MD.replace(
      '### WP-QA-JD-PR: 프로세스', '### WP-QA-JD-XX: 빈 WP\n\n### WP-QA-JD-PR: 프로세스')), 'pl')
    expect(w.errors).toEqual([])
    expect(w.warnings.some(x => x.includes('leaf'))).toBe(true)
  })
})

describe('toImportNodes — v2.2 payload 노드', () => {
  const nodes = toImportNodes(parseWbsMarkdown(PL_MD))
  const byId = new Map(nodes.map(n => [n.id, n]))
  it('fold — STK 는 노드로 안 나가고 부모 acceptance 로', () => {
    expect(byId.has('STK-QA-JD-PR-01-1')).toBe(false)
    const t = byId.get('TSK-QA-JD-PR-01')!
    expect(t.acceptance).toContain('룰 테이블 기반')
    expect(t.acceptance).toContain('[ ] 판정 룰 테이블 설계 리뷰')
    expect(t.acceptance).toContain('[x] 등급 하향 규칙 케이스 정리')
  })
  it('필드 매핑 — level·weight·schedule·milestone·credit·if_id·spec_sections', () => {
    const t = byId.get('TSK-QA-JD-PR-01')!
    expect(t).toMatchObject({
      level: 5, weight: 5, schedule: '2026-12-19 ~ 2026-12-19', kind: 'task', // 선행(PR-02) 종료가 더 늦어 시작=종료로 고정
      assignee: '홍길동', depends: ['TSK-QA-JD-PR-02'], tags: ['qa', 'judge'],
      prd_ref: 'program:QA-JD-001', milestone: false,
    })
    expect(t.spec_sections?.requirements).toEqual(['시험 실적을 기준과 대조해 자동 판정한다.'])
    expect(byId.get('TSK-QA-JD-PR-02')).toMatchObject({ credit: 'if', if_id: 'IF-0041' })
    expect(byId.get('TSK-QA-JD-PR-90')).toMatchObject({ milestone: true, schedule: '~ 2027-01-09' })
  })
  it('schedule — 시작~종료 범위 토큰은 그대로, 종료만이면 선행 종료 다음 영업일로 시작 파생', () => {
    const md = `---
module: m
start_date: 2026-08-31
levels:
  - { name: WP,   prefix: WP,  progress: rollup }
  - { name: Task, prefix: TSK, progress: input }
---
## WP-01: 묶음
- [ ] TSK-01: 명시 2026-09-01~2026-09-03
- [ ] TSK-02: 선행 없음 ~2026-09-05
- [ ] TSK-03: 금요일 종료 선행 ~2026-09-10
  - depends: TSK-01
- [ ] TSK-04: 선행 종료가 더 늦음 ~2026-09-02
  - depends: TSK-03
- [ ] TSK-05: 선행에 종료 없음 ~2026-09-12
  - depends: TSK-06
- [ ] TSK-06: 날짜 없음
- [M] TSK-07: 마일스톤 ~2026-09-30
`
    const byId = Object.fromEntries(toImportNodes(parseWbsMarkdown(md)).map(n => [n.id, n.schedule]))
    expect(byId['TSK-01']).toBe('2026-09-01 ~ 2026-09-03')     // 범위 토큰 그대로
    expect(byId['TSK-02']).toBe('2026-08-31 ~ 2026-09-05')     // 선행 없음 → start_date
    expect(byId['TSK-03']).toBe('2026-09-04 ~ 2026-09-10')     // 선행 종료 09-03(목) → 09-04(금)
    expect(byId['TSK-04']).toBe('2026-09-02 ~ 2026-09-02')     // 파생 시작(09-11) > 종료 → 종료로 고정
    expect(byId['TSK-05']).toBe('2026-08-31 ~ 2026-09-12')     // 선행에 종료 없음 → start_date
    expect(byId['TSK-06']).toBeNull()
    expect(byId['TSK-07']).toBe('~ 2026-09-30')                // 마일스톤은 파생 안 함
  })

  it('nextBusinessDay — 금요일 다음은 월요일', () => {
    expect(nextBusinessDay('2026-09-04')).toBe('2026-09-07')
    expect(nextBusinessDay('2026-09-05')).toBe('2026-09-07')
    expect(nextBusinessDay('2026-09-07')).toBe('2026-09-08')
  })

  it('결정적 — 재파싱 = 동일 출력', () => {
    expect(toImportNodes(parseWbsMarkdown(PL_MD))).toEqual(nodes)
  })
})
