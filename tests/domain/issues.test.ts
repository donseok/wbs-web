import { describe, it, expect } from 'vitest'
import {
  ISSUE_STATUSES, ISSUE_SEVERITIES, STATUS_TRANSITIONS,
  canTransition, isOverdue, nextResolvedAt, sortIssues, filterIssues, canEditIssue,
  type Issue,
} from '@/lib/domain/issues'

function issue(id: string, opts: Partial<Issue> = {}): Issue {
  return {
    id, issueNo: 1, projectId: 'p1', title: `이슈 ${id}`, body: '',
    status: 'open', severity: 'medium', assigneeMemberIds: [], dueDate: null,
    resolutionNote: '', resolvedAt: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00+00:00', updatedAt: '2026-07-01T00:00:00+00:00', ...opts,
  }
}
const TODAY = '2026-07-23'

describe('STATUS_TRANSITIONS / canTransition — 전환 맵 전수', () => {
  it('맵은 4개 상태 전부를 키로 갖는다', () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...ISSUE_STATUSES].sort())
  })
  it('허용 전환: open→in_progress/on_hold/resolved, in_progress→open/on_hold/resolved, on_hold→open/in_progress/resolved, resolved→open/in_progress', () => {
    expect(STATUS_TRANSITIONS.open).toEqual(['in_progress', 'on_hold', 'resolved'])
    expect(STATUS_TRANSITIONS.in_progress).toEqual(['open', 'on_hold', 'resolved'])
    expect(STATUS_TRANSITIONS.on_hold).toEqual(['open', 'in_progress', 'resolved'])
    expect(STATUS_TRANSITIONS.resolved).toEqual(['open', 'in_progress'])
  })
  it('거부 전환: 자기 자신·resolved→on_hold', () => {
    for (const s of ISSUE_STATUSES) expect(canTransition(s, s)).toBe(false)
    expect(canTransition('resolved', 'on_hold')).toBe(false)
  })
})

describe('isOverdue — 지연 판정', () => {
  it('기한 경과 + 미해결이면 지연', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-22' }), TODAY)).toBe(true)
  })
  it('기한 당일은 지연 아님(경계)', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-23' }), TODAY)).toBe(false)
  })
  it('resolved 는 기한이 지나도 지연 아님', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-01', status: 'resolved' }), TODAY)).toBe(false)
  })
  it('기한 없음은 지연 아님', () => {
    expect(isOverdue(issue('a'), TODAY)).toBe(false)
  })
  it('on_hold 도 기한 경과면 지연(미해결이므로)', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-22', status: 'on_hold' }), TODAY)).toBe(true)
  })
})

describe('nextResolvedAt — resolved 진입/이탈 규칙', () => {
  const NOW = '2026-07-23T09:00:00.000Z'
  it('resolved 진입 시 now', () => {
    expect(nextResolvedAt('open', 'resolved', null, NOW)).toBe(NOW)
  })
  it('resolved 이탈 시 null', () => {
    expect(nextResolvedAt('resolved', 'open', '2026-07-20T00:00:00Z', NOW)).toBeNull()
  })
  it('resolved 무관 전환은 현재값 유지', () => {
    expect(nextResolvedAt('open', 'in_progress', null, NOW)).toBeNull()
    expect(nextResolvedAt('in_progress', 'on_hold', null, NOW)).toBeNull()
  })
})

describe('sortIssues — 미해결 → 지연 → 심각도 → 목표일 → 최신 등록', () => {
  it('resolved 는 항상 마지막', () => {
    const r = sortIssues([issue('done', { status: 'resolved', severity: 'high' }), issue('open1')], TODAY)
    expect(r.map(i => i.id)).toEqual(['open1', 'done'])
  })
  it('미해결 안에서 지연이 먼저', () => {
    const r = sortIssues([issue('later', { dueDate: '2026-08-01' }), issue('over', { dueDate: '2026-07-01' })], TODAY)
    expect(r.map(i => i.id)).toEqual(['over', 'later'])
  })
  it('같은 지연 여부면 심각도 높음 먼저', () => {
    const r = sortIssues([issue('lo', { severity: 'low' }), issue('hi', { severity: 'high' }), issue('mid')], TODAY)
    expect(r.map(i => i.id)).toEqual(['hi', 'mid', 'lo'])
  })
  it('같은 심각도면 목표일 오름차순, 목표일 없음은 뒤', () => {
    const r = sortIssues([issue('none'), issue('aug', { dueDate: '2026-08-10' }), issue('jul', { dueDate: '2026-07-30' })], TODAY)
    expect(r.map(i => i.id)).toEqual(['jul', 'aug', 'none'])
  })
  it('전부 같으면 최신 등록순(createdAt desc)', () => {
    const r = sortIssues([
      issue('old', { createdAt: '2026-07-01T00:00:00+00:00' }),
      issue('new', { createdAt: '2026-07-20T00:00:00+00:00' }),
    ], TODAY)
    expect(r.map(i => i.id)).toEqual(['new', 'old'])
  })
  it('원본 배열을 변경하지 않는다', () => {
    const src = [issue('b', { severity: 'low' }), issue('a', { severity: 'high' })]
    sortIssues(src, TODAY)
    expect(src.map(i => i.id)).toEqual(['b', 'a'])
  })
})

describe('filterIssues — 상태·심각도·내 담당', () => {
  const list = [
    issue('a', { status: 'open', severity: 'high', assigneeMemberIds: ['m1'] }),
    issue('b', { status: 'resolved', severity: 'low', assigneeMemberIds: ['m2', 'm3'] }),
    issue('c', { status: 'open', severity: 'low', assigneeMemberIds: [] }),
  ]
  it('all 필터는 전량 통과', () => {
    expect(filterIssues(list, { status: 'all', severity: 'all', mineOnly: false, myMemberIds: new Set() })).toHaveLength(3)
  })
  it('상태·심각도 AND 결합', () => {
    const r = filterIssues(list, { status: 'open', severity: 'low', mineOnly: false, myMemberIds: new Set() })
    expect(r.map(i => i.id)).toEqual(['c'])
  })
  it('내 담당은 myMemberIds 포함 여부 — 미지정 담당은 제외', () => {
    const r = filterIssues(list, { status: 'all', severity: 'all', mineOnly: true, myMemberIds: new Set(['m1']) })
    expect(r.map(i => i.id)).toEqual(['a'])
  })
  it('여러 담당자 중 한 명만 나여도 내 담당이다', () => {
    const r = filterIssues(list, { status: 'all', severity: 'all', mineOnly: true, myMemberIds: new Set(['m3']) })
    expect(r.map(i => i.id)).toEqual(['b'])
  })
})

describe('canEditIssue — 전체 편집/삭제 게이트(UI 노출용)', () => {
  it('pmo_admin 은 항상 가능', () => {
    expect(canEditIssue(issue('a', { createdBy: 'other' }), 'me', 'pmo_admin')).toBe(true)
  })
  it('작성자 본인 가능, 타인 불가', () => {
    expect(canEditIssue(issue('a', { createdBy: 'me' }), 'me', 'team_editor')).toBe(true)
    expect(canEditIssue(issue('a', { createdBy: 'other' }), 'me', 'team_editor')).toBe(false)
  })
  it('비로그인·작성자 미상은 불가', () => {
    expect(canEditIssue(issue('a', { createdBy: 'me' }), null, null)).toBe(false)
    expect(canEditIssue(issue('a', { createdBy: null }), 'me', 'team_editor')).toBe(false)
  })
})

describe('심각도 상수', () => {
  it('ISSUE_SEVERITIES 는 high/medium/low', () => {
    expect([...ISSUE_SEVERITIES]).toEqual(['high', 'medium', 'low'])
  })
})
