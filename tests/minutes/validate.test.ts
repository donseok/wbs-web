import { describe, it, expect } from 'vitest'
import {
  validateMinuteInput, sanitizeFileName, isMinuteFilePathValid, ilikeOrPattern,
  MINUTE_BODY_MAX, type MinuteInput,
} from '@/lib/domain/minutes'

const base: MinuteInput = {
  minuteDate: '2026-07-09', teamCode: 'ERP', title: '주간 정례회의',
  bodyMd: '# 안건\n- 진행 현황', meetingId: null,
}

describe('validateMinuteInput', () => {
  it('정상 입력은 null', () => expect(validateMinuteInput(base)).toBeNull())
  it('제목 없음', () => expect(validateMinuteInput({ ...base, title: '  ' })).toMatch(/제목/))
  it('제목 200자 초과', () =>
    expect(validateMinuteInput({ ...base, title: 'a'.repeat(201) })).toMatch(/200/))
  it('날짜 형식 오류', () =>
    expect(validateMinuteInput({ ...base, minuteDate: '2026/07/09' })).toMatch(/날짜/))
  it('잘못된 담당', () =>
    expect(validateMinuteInput({ ...base, teamCode: 'QA' as never })).toMatch(/담당/))
  it('본문 캡 초과', () =>
    expect(validateMinuteInput({ ...base, bodyMd: 'a'.repeat(MINUTE_BODY_MAX + 1) })).toMatch(/100,000/))
  it('빈 본문 허용', () => expect(validateMinuteInput({ ...base, bodyMd: '' })).toBeNull())
})

describe('sanitizeFileName', () => {
  it('허용 외 문자 → _', () => expect(sanitizeFileName('weekly meeting(July).md')).toBe('weekly_meeting_July_.md'))
  it('영숫자/._- 보존', () => expect(sanitizeFileName('minutes-7.9_draft.md')).toBe('minutes-7.9_draft.md'))

  it('한글 파일명도 Supabase Storage 키에 안전한 ASCII로 변환하고 확장자를 보존', () => {
    const safe = sanitizeFileName('내수영업_인터뷰_임가공__2026-07-08.md')

    expect(safe).toBe('_2026-07-08.md')
    expect(safe).toMatch(/^[A-Za-z0-9_.-]+$/)
    expect(safe).toMatch(/\.md$/)
  })

  it('구분자만 남는 파일명은 안전한 기본값 사용', () =>
    expect(sanitizeFileName('한글파일')).toBe('file'))
})

describe('isMinuteFilePathValid', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('자기 접두 경로 허용', () => expect(isMinuteFilePathValid(id, `${id}/123-a.md`)).toBe(true))
  it('타 회의록 경로 거부', () =>
    expect(isMinuteFilePathValid(id, '99999999-2222-3333-4444-555555555555/123-a.md')).toBe(false))
  it('경로 순회 거부', () => expect(isMinuteFilePathValid(id, `${id}/../etc/x`)).toBe(false))
})

describe('ilikeOrPattern', () => {
  it('일반 문자열은 인용된 %패턴%', () => expect(ilikeOrPattern('예산')).toBe('"%예산%"'))
  it('쉼표/괄호는 인용부 안에서 그대로 안전', () =>
    expect(ilikeOrPattern('일정, 예산(안)')).toBe('"%일정, 예산(안)%"'))
  it('LIKE 와일드카드 이스케이프', () =>
    expect(ilikeOrPattern('100%_달성')).toBe('"%100\\\\%\\\\_달성%"'))
  it('역슬래시는 LIKE→인용 2단 이스케이프', () =>
    expect(ilikeOrPattern('a\\b')).toBe('"%a\\\\\\\\b%"'))
  it('큰따옴표 이스케이프', () => expect(ilikeOrPattern('회의"록"')).toBe('"%회의\\"록\\"%"'))
})
