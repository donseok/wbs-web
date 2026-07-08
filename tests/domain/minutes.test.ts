import { describe, it, expect } from 'vitest'
import {
  MINUTES_MD_MAX,
  isMarkdownFile, sanitizeFileName, minutesStoragePath,
  canCreateMinutes, canDeleteMinutes, validateMinutesInput,
  filterMinutes, summarizeMinutes,
} from '@/lib/domain/minutes'
import type { MeetingMinutes, Membership } from '@/lib/domain/types'

const PMO: Membership = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't-pmo' }
const ERP: Membership = { role: 'team_editor', teamCode: 'ERP', teamId: 't-erp' }

function row(over: Partial<MeetingMinutes> = {}): MeetingMinutes {
  return {
    id: 'm1', projectId: 'p1', teamId: 't-erp', teamCode: 'ERP', meetingId: null,
    minutesDate: '2026-07-08', title: '킥오프', filePath: 'p1/t-erp/1-a.md', fileName: 'a.md',
    size: 10, mime: 'text/markdown', hasMd: true,
    createdBy: 'u1', createdByName: '홍길동', createdAt: '2026-07-08T01:00:00Z',
    ...over,
  }
}

describe('isMarkdownFile', () => {
  it.each([
    ['a.md', true],
    ['A.MD', true],
    ['notes.markdown', true],
    ['a.md.pdf', false],
    ['deck.pptx', false],
    ['README', false],
    // mime 이 text/markdown 이어도 확장자가 아니면 false —
    // DB 의 minutes_md_only 제약이 file_path 확장자를 보기 때문.
    ['x.txt', false],
  ])('%s → %s', (name, expected) => {
    expect(isMarkdownFile(name)).toBe(expected)
  })
})

describe('sanitizeFileName', () => {
  it('한글은 보존한다', () => {
    expect(sanitizeFileName('주간회의록.md')).toBe('주간회의록.md')
  })
  it('공백과 슬래시를 _ 로 바꾼다', () => {
    expect(sanitizeFileName('a b/c.md')).toBe('a_b_c.md')
  })
  it('경로 세그먼트가 .. 가 되지 않게 한다', () => {
    expect(sanitizeFileName('..')).toBe('file')
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
  it('빈 결과를 만들지 않는다', () => {
    expect(sanitizeFileName('///')).toBe('file')
  })
})

describe('minutesStoragePath', () => {
  it('nowMs 를 주입하면 결정적이다', () => {
    expect(minutesStoragePath('p1', 't-erp', '주간 회의.md', 1700000000000))
      .toBe('p1/t-erp/1700000000000-주간_회의.md')
  })
})

describe('canCreateMinutes', () => {
  it('비로그인은 거부', () => expect(canCreateMinutes(null, 't-erp')).toBe(false))
  it('pmo_admin 은 모든 팀 허용', () => expect(canCreateMinutes(PMO, 't-erp')).toBe(true))
  it('team_editor 는 자기 팀만', () => {
    expect(canCreateMinutes(ERP, 't-erp')).toBe(true)
    expect(canCreateMinutes(ERP, 't-mes')).toBe(false)
  })
})

describe('canDeleteMinutes', () => {
  it('userId 가 없으면 거부', () => expect(canDeleteMinutes({ createdBy: 'u1' }, null, 'pmo_admin')).toBe(false))
  it('pmo_admin 은 남의 것도 삭제', () => expect(canDeleteMinutes({ createdBy: 'u2' }, 'u1', 'pmo_admin')).toBe(true))
  it('작성자 본인은 삭제', () => expect(canDeleteMinutes({ createdBy: 'u1' }, 'u1', 'team_editor')).toBe(true))
  it('남의 것은 거부', () => expect(canDeleteMinutes({ createdBy: 'u2' }, 'u1', 'team_editor')).toBe(false))
  it('createdBy 가 null 이면 작성자 매칭 불가', () => expect(canDeleteMinutes({ createdBy: null }, 'u1', 'team_editor')).toBe(false))
})

describe('validateMinutesInput', () => {
  const base = { teamId: 't-erp', minutesDate: '2026-07-08', title: '킥오프', contentMd: '# hi' }
  it('정상 입력은 null', () => expect(validateMinutesInput(base)).toBeNull())
  it('제목 공백 반려', () => expect(validateMinutesInput({ ...base, title: '  ' })).toBe('제목을 입력하세요.'))
  it('제목 201자 반려', () => expect(validateMinutesInput({ ...base, title: 'a'.repeat(201) })).toContain('200자'))
  it('날짜 형식 반려', () => expect(validateMinutesInput({ ...base, minutesDate: '2026-7-8' })).toContain('날짜'))
  it('실재하지 않는 날짜 반려', () => expect(validateMinutesInput({ ...base, minutesDate: '2026-02-30' })).toContain('날짜'))
  it('teamId 빈 문자열 반려', () => expect(validateMinutesInput({ ...base, teamId: '' })).toBe('팀을 선택하세요.'))
  it('contentMd 길이 초과 반려', () => {
    expect(validateMinutesInput({ ...base, contentMd: 'a'.repeat(MINUTES_MD_MAX + 1) })).toContain('너무 큽')
  })
  it('contentMd null 은 허용(비-md 업로드)', () => expect(validateMinutesInput({ ...base, contentMd: null })).toBeNull())
})

describe('filterMinutes', () => {
  const list = [
    row({ id: 'a', teamId: 't-erp', title: 'ERP 킥오프', createdByName: '홍길동' }),
    row({ id: 'b', teamId: 't-mes', title: 'MES 점검', createdByName: 'Kim' }),
  ]
  it('팀 필터', () => expect(filterMinutes(list, { teamId: 't-mes', q: '' }).map(r => r.id)).toEqual(['b']))
  it('teamId null 이면 전체', () => expect(filterMinutes(list, { teamId: null, q: '' })).toHaveLength(2))
  it('제목 부분일치', () => expect(filterMinutes(list, { teamId: null, q: '킥오프' }).map(r => r.id)).toEqual(['a']))
  it('등록자 부분일치 + 대소문자 무시', () => expect(filterMinutes(list, { teamId: null, q: 'kim' }).map(r => r.id)).toEqual(['b']))
  it('입력 배열을 변형하지 않는다', () => {
    const before = list.map(r => r.id)
    filterMinutes(list, { teamId: 't-mes', q: '' })
    expect(list.map(r => r.id)).toEqual(before)
  })
})

describe('summarizeMinutes', () => {
  it('빈 목록', () => expect(summarizeMinutes([], '2026-07-08')).toEqual({ total: 0, thisMonth: 0, viewable: 0 }))
  it('이번 달과 바로보기 가능 건수', () => {
    const list = [
      row({ id: 'a', minutesDate: '2026-07-01', hasMd: true }),
      row({ id: 'b', minutesDate: '2026-07-31', hasMd: false }),
      row({ id: 'c', minutesDate: '2026-06-30', hasMd: true }),
    ]
    expect(summarizeMinutes(list, '2026-07-08')).toEqual({ total: 3, thisMonth: 2, viewable: 2 })
  })
})
