import { describe, it, expect } from 'vitest'
import {
  validateMinuteInput, sanitizeFileName, isMinuteFilePathValid,
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
  it('허용 외 문자 → _', () => expect(sanitizeFileName('주간 회의(7월).md')).toBe('주간_회의_7월_.md'))
  it('한글/영숫자/._- 보존', () => expect(sanitizeFileName('minutes-7.9_초안.md')).toBe('minutes-7.9_초안.md'))
})

describe('isMinuteFilePathValid', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('자기 접두 경로 허용', () => expect(isMinuteFilePathValid(id, `${id}/123-a.md`)).toBe(true))
  it('타 회의록 경로 거부', () =>
    expect(isMinuteFilePathValid(id, '99999999-2222-3333-4444-555555555555/123-a.md')).toBe(false))
  it('경로 순회 거부', () => expect(isMinuteFilePathValid(id, `${id}/../etc/x`)).toBe(false))
})
