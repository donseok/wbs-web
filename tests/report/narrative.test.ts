import { describe, it, expect } from 'vitest'
import { buildWeeklyReportModel, NO_ISSUE_TEXT } from '@/lib/report/weekly'
import { buildWeeklyNarrative, mergeDuplicateLines } from '@/lib/report/narrative'
import type { Announcement, ComputedItem, Meeting } from '@/lib/domain/types'

const node = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: '1', sortOrder: 1,
    name: 'n', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem
const phase = (name: string, children: ComputedItem[], over: Partial<ComputedItem> = {}): ComputedItem =>
  node({ level: 'phase', name, children, ...over })

const items: ComputedItem[] = [
  phase('설계', [
    node({ name: '전주완료작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
    node({ name: '금주진행작업', status: 'in_progress', rolledActualPct: 50, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
  ], { weight: 1, plannedPct: 100, rolledActualPct: 60 }),
]
const project = { name: 'D-CUBE PI', description: null, start_date: null, end_date: null }

describe('mergeDuplicateLines', () => {
  it('공백 정규화 후 같은 줄은 한 줄로', () =>
    expect(mergeDuplicateLines(['설계  검토', '설계 검토', '데이터 정리'])).toEqual(['설계 검토', '데이터 정리']))
  it('꼬리 괄호만 다른 줄은 꼬리를 "·"로 합쳐 요약', () =>
    expect(mergeDuplicateLines(['설계 검토 (1차)', '설계 검토 (2차)', '설계 검토 (1차)']))
      .toEqual(['설계 검토 (1차·2차)']))
  it('꼬리 없는 줄과 꼬리 있는 줄이 섞이면 꼬리 쪽으로 합친다', () =>
    expect(mergeDuplicateLines(['설계 검토', '설계 검토 (1차)'])).toEqual(['설계 검토 (1차)']))
  it('중복 없는 줄은 원문 그대로(붙은 괄호에 공백을 만들지 않음)', () =>
    expect(mergeDuplicateLines(['산출물 검토(인터뷰, 공청회, 진단)', '계획 수립']))
      .toEqual(['산출물 검토(인터뷰, 공청회, 진단)', '계획 수립']))
  it('첫 등장 순서를 유지하고 빈 줄은 버린다', () =>
    expect(mergeDuplicateLines(['B', '', 'A', 'B'])).toEqual(['B', 'A']))
})

describe('buildWeeklyNarrative', () => {
  const m = buildWeeklyReportModel(items, project, '2026-07-07')
  const n = buildWeeklyNarrative(m)

  it('prev/curr가 Phase 그룹으로 나오고 빈 Phase는 제외', () => {
    expect(n.prev.map(g => g.phase)).toContain('설계')
    expect(n.prev[0].items.some(s => s.includes('전주완료작업'))).toBe(true)
    expect(n.curr[0].items.some(s => s.includes('금주진행작업'))).toBe(true)
  })
  it('담당은 "- 담당" 헤더, 작업은 그 아래 ". 작업명" 줄(상태·진행률 제외)', () => {
    expect(n.curr[0].items).toEqual(['- MES', '. 금주진행작업'])
    const joined = n.curr[0].items.join('\n')
    expect(joined).not.toContain('진행중')  // 진행사항(완료/진행중/지연) 미표기
    expect(joined).not.toContain('%')
    expect(joined).not.toContain('50')
  })
  it('이슈/이벤트는 문자열 배열', () => {
    expect(Array.isArray(n.issues)).toBe(true)
    expect(Array.isArray(n.events)).toBe(true)
  })
  it('Phase 번호(num)가 전주·금주에서 동일 Phase에 같은 값', () => {
    // 준비(index0): 준비완료작업(done, 전주) → 전주만. 설계(index1): 설계작업(in_progress, 전주+금주) → 양쪽.
    const twoPhase: ComputedItem[] = [
      phase('준비', [
        node({ name: '준비완료작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 100 }),
      phase('설계', [
        node({ name: '설계작업', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 60 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(twoPhase, project, '2026-07-07'))
    const prevPrep = n2.prev.find(g => g.phase === '준비')!
    const prevDesign = n2.prev.find(g => g.phase === '설계')!
    const currDesign = n2.curr.find(g => g.phase === '설계')!
    expect(prevPrep.num).toBe(1)
    expect(prevDesign.num).toBe(2)
    // 준비(1)가 금주에 없어도 설계는 재번호되지 않고 2 유지
    expect(currDesign.num).toBe(2)
    expect(n2.curr.find(g => g.phase === '준비')).toBeUndefined()
  })

  it('같은 담당의 여러 작업은 담당 헤더 하나로 묶인다(중복 표기 방지)', () => {
    const multi: ComputedItem[] = [
      phase('As-Is 분석', [
        node({ name: '작업A', status: 'in_progress', rolledActualPct: 30, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '작업B', status: 'in_progress', rolledActualPct: 40, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '작업C', status: 'in_progress', rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 40 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(multi, project, '2026-07-07'))
    expect(n2.curr[0].items).toEqual(['- MES', '. 작업A', '. 작업B', '- PMO', '. 작업C'])
  })

  it('같은 담당 아래 중복 작업명은 한 줄로 합쳐진다(주요내용 중복 병합 규칙)', () => {
    const dup: ComputedItem[] = [
      phase('실행', [
        node({ name: '주간보고 작성', status: 'in_progress', rolledActualPct: 30, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '주간보고 작성', status: 'in_progress', rolledActualPct: 60, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '설계 검토 (1차)', status: 'in_progress', rolledActualPct: 40, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '설계 검토 (2차)', status: 'in_progress', rolledActualPct: 20, owners: [{ team: 'MES', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 40 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(dup, project, '2026-07-07'))
    expect(n2.curr[0].items).toEqual(['- MES', '. 주간보고 작성', '. 설계 검토 (1차·2차)'])
  })

  it('담당 미지정 중복 작업도 한 줄로 합쳐진다', () => {
    const dup: ComputedItem[] = [
      phase('실행', [
        node({ name: '데이터 정리', status: 'in_progress', rolledActualPct: 30, owners: [], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '데이터 정리', status: 'in_progress', rolledActualPct: 50, owners: [], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 40 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(dup, project, '2026-07-07'))
    expect(n2.curr[0].items).toEqual(['데이터 정리'])
  })

  it('중복 이슈 문구는 한 줄로 합쳐진다', () => {
    const late: ComputedItem[] = [
      phase('실행', [
        node({ name: '지연작업', status: 'delayed', rolledActualPct: 10, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
        node({ name: '지연작업', status: 'delayed', rolledActualPct: 10, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 10 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(late, project, '2026-07-07'))
    expect(n2.issues.length).toBe(new Set(n2.issues).size) // 동일 문구 중복 없음
  })

  it('작업명 끝의 "(X 주관)" 꼬리표는 제거되고 중간 괄호는 보존된다', () => {
    const suffixed: ComputedItem[] = [
      phase('As-Is 분석', [
        node({ name: '기존 PI 산출물 검토(인터뷰, 공청회, 진단) (ERP 주관)', status: 'in_progress', rolledActualPct: 30, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '인터뷰 계획 수립 (PMO주관)', status: 'in_progress', rolledActualPct: 20, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
        node({ name: '무담당 정리 (MES 주관)', status: 'in_progress', rolledActualPct: 10, owners: [], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 20 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(suffixed, project, '2026-07-07'))
    expect(n2.curr[0].items).toEqual([
      '- ERP', '. 기존 PI 산출물 검토(인터뷰, 공청회, 진단)',
      '- PMO', '. 인터뷰 계획 수립',
      '무담당 정리',
    ])
  })

  it('담당 미지정 작업은 헤더 없이 "작업명" 그대로', () => {
    const noOwner: ComputedItem[] = [
      phase('준비', [
        node({ name: '무담당작업', status: 'in_progress', rolledActualPct: 10, owners: [], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 10 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(noOwner, project, '2026-07-07'))
    expect(n2.curr[0].items).toEqual(['무담당작업'])
  })

  it('회의가 있으면 events에 반영', () => {
    // today=2026-07-07(화) → 금주 범위는 7/6~7/12 (buildWeeklyReportModel의 월요일 기준 계산).
    // meetingDate 2026-07-10 은 금주 범위 안 → model.meetings.thisWeek 로 전개되어야 events 에 반영된다.
    const meetings: Meeting[] = [
      {
        id: 'mtg1', projectId: 'p', title: 'Kick-Off', meetingDate: '2026-07-10',
        startTime: '14:00', endTime: '15:00', location: '대회의실', category: 'kickoff', body: '',
        recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: Array.from({ length: 8 }, (_, i) => `m${i}`),
      },
    ]
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', { meetings })
    const n2 = buildWeeklyNarrative(m2)
    expect(n2.events.some(e => e.includes('Kick-Off'))).toBe(true)
  })

  it('공지는 주요활동이 아니라 이벤트 목록에 "[공지]" 표기·M/D(요일) 날짜로 실린다', () => {
    const ann = (title: string, publishFrom: string): Announcement => ({
      id: title, projectId: 'p', title, body: '', category: 'general', isPinned: false,
      publishFrom, publishTo: null, createdAt: '2026-07-07T00:00:00Z', updatedAt: '2026-07-07T00:00:00Z',
    })
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', {
      announcements: [ann('전주 킥오프 안내', '2026-07-01'), ann('금주 산출물 마감', '2026-07-06')],
    })
    const n2 = buildWeeklyNarrative(m2)

    // 주요활동(콘텐츠 셀)에는 공지 그룹이 없다
    expect(n2.prev.some(g => g.phase === '주요 공지')).toBe(false)
    expect(n2.curr.some(g => g.phase === '주요 공지')).toBe(false)
    // 이벤트 목록에 전주→금주 순, 회의와 동일한 날짜 표기 + [공지] 마커
    expect(n2.events).toContain('7/1(수) [공지] 전주 킥오프 안내')
    expect(n2.events).toContain('7/6(월) [공지] 금주 산출물 마감')
    // WBS 그룹은 그대로 유지된다
    expect(n2.prev[0].phase).toBe('설계')
  })

  it('회의와 공지가 함께 있으면 회의가 앞, 공지가 뒤', () => {
    const ann = (title: string, publishFrom: string): Announcement => ({
      id: title, projectId: 'p', title, body: '', category: 'general', isPinned: false,
      publishFrom, publishTo: null, createdAt: '2026-07-07T00:00:00Z', updatedAt: '2026-07-07T00:00:00Z',
    })
    const meetings: Meeting[] = [
      {
        id: 'mtg1', projectId: 'p', title: 'Kick-Off', meetingDate: '2026-07-10',
        startTime: '14:00', endTime: '15:00', location: '대회의실', category: 'kickoff', body: '',
        recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: ['m1'],
      },
    ]
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', {
      meetings, announcements: [ann('산출물 마감', '2026-07-06')],
    })
    const n2 = buildWeeklyNarrative(m2)
    const iMeeting = n2.events.findIndex(e => e.includes('Kick-Off'))
    const iAnn = n2.events.findIndex(e => e.includes('[공지]'))
    expect(iMeeting).toBeGreaterThanOrEqual(0)
    expect(iAnn).toBeGreaterThan(iMeeting)
  })

  it('Phase 이름의 선행 번호("1. ", "1-1.", "2)")는 헤드라인에서 제거된다', () => {
    const numbered: ComputedItem[] = [
      phase('1. 프로젝트 준비 및 착수', [
        node({ name: '준비작업', status: 'done', rolledActualPct: 100, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 100 }),
      phase('2. As-Is 분석', [
        node({ name: '분석작업', status: 'in_progress', rolledActualPct: 40, owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 40 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(numbered, project, '2026-07-07'))
    expect(n2.prev.map(g => g.phase)).toContain('프로젝트 준비 및 착수')
    expect(n2.curr.map(g => g.phase)).toContain('As-Is 분석')
    expect([...n2.prev, ...n2.curr].some(g => /^\d/.test(g.phase))).toBe(false)
  })

  it('번호 형식이 아닌 숫자 시작 이름("2026년 계획")은 보존된다', () => {
    const yearly: ComputedItem[] = [
      phase('2026년 계획', [
        node({ name: '계획작업', status: 'in_progress', rolledActualPct: 10, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 10 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(yearly, project, '2026-07-07'))
    expect(n2.curr[0].phase).toBe('2026년 계획')
  })

  it('공지 없으면 이벤트 목록에 "[공지]" 항목이 없고 WBS-only 동작 유지', () => {
    expect(n.events.some(e => e.includes('[공지]'))).toBe(false)
    expect(n.prev.length).toBeGreaterThan(0)
  })

  it('이슈 0건 대체 문구는 모델(Excel·봇)에는 남고 PPT 서술에서는 걸러진다', () => {
    const onTrack: ComputedItem[] = [
      phase('실행', [
        node({ name: '정상작업', status: 'in_progress', rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-07-06', plannedEnd: '2026-07-10' }),
      ], { weight: 1, plannedPct: 50, rolledActualPct: 50 }),
    ]
    const m2 = buildWeeklyReportModel(onTrack, project, '2026-07-07')
    expect(m2.issues.map(i => i.content)).toEqual([NO_ISSUE_TEXT]) // 모델은 현상 유지
    expect(buildWeeklyNarrative(m2).issues).toEqual([])            // PPT 이슈 셀은 빈칸
  })

  it('실제 이슈는 PPT 서술에 그대로 남는다', () => {
    const late: ComputedItem[] = [
      phase('실행', [
        node({ name: '지연작업', status: 'delayed', rolledActualPct: 10, owners: [{ team: 'PMO', kind: 'primary' }], plannedStart: '2026-06-29', plannedEnd: '2026-07-03' }),
      ], { weight: 1, plannedPct: 100, rolledActualPct: 10 }),
    ]
    const n2 = buildWeeklyNarrative(buildWeeklyReportModel(late, project, '2026-07-07'))
    expect(n2.issues.length).toBeGreaterThan(0)
    expect(n2.issues.some(c => c.includes(NO_ISSUE_TEXT))).toBe(false)
  })

  it('같은 회의의 반복 회차는 날짜 구간 한 줄로 병합되고 장소는 제목과 중복 표기하지 않는다', () => {
    const mk = (id: string, title: string, meetingDate: string, location: string): Meeting => ({
      id, projectId: 'p', title, meetingDate, startTime: '10:00', endTime: '11:00', location,
      category: 'kickoff', body: '', recurrence: 'none', recurrenceUntil: null,
      createdBy: null, createdByName: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', attendeeIds: ['m1'],
    })
    const m2 = buildWeeklyReportModel(items, project, '2026-07-07', {
      meetings: [
        mk('a1', '아주스틸 인터뷰', '2026-07-08', '구미 공장'),
        mk('a2', '아주스틸 인터뷰', '2026-07-09', '구미 공장'),
        mk('b1', 'MES 품질회의 (부산공장)', '2026-07-10', '부산공장'),
        mk('c1', '주간회의', '2026-07-08', '-'),
        mk('c2', '주간회의', '2026-07-10', '-'),
      ],
    })
    const n2 = buildWeeklyNarrative(m2)
    expect(n2.events).toContain('7/8(수)~7/9(목) 아주스틸 인터뷰 (구미 공장)') // 연속 → '~' 구간
    expect(n2.events).toContain('7/10(금) MES 품질회의 (부산공장)')            // '(부산공장) (부산공장)' 방지
    expect(n2.events).toContain('7/8(수)·7/10(금) 주간회의')                   // 비연속 → '·' 나열
    expect(n2.events).toHaveLength(3)                                          // 회차 5건 → 3줄
  })
})
