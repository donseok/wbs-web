import { describe, it, expect } from 'vitest'
import { correctMinuteBodyTime, TZ_OFFSET_HOURS } from '@/lib/minutes/timeFix'

/** 4-마커 메타 헤더가 있는 녹취툴 산출물 본문. */
function toolBody(timeLine: string): string {
  return [
    '# 칼라생산팀 2026.07.15',
    '',
    '- **날짜**: 2026-07-15',
    `- **시간**: ${timeLine}`,
    '- **상태**: 완료',
    '- **생성자**: 관리자',
    '',
    '---',
    '',
    '## AI 회의록',
    '본문 내용',
  ].join('\n')
}

describe('correctMinuteBodyTime', () => {
  it('오프셋 상수는 +9(KST)', () => {
    expect(TZ_OFFSET_HOURS).toBe(9)
  })

  it('녹취툴 서명이 있으면 시간 줄만 +9h 보정하고 corrected/from/to 반환', () => {
    const r = correctMinuteBodyTime(toolBody('00:01 ~ 01:59'))
    expect(r.corrected).toBe(true)
    expect(r.from).toBe('00:01 ~ 01:59')
    expect(r.to).toBe('09:01 ~ 10:59')
    expect(r.body).toContain('- **시간**: 09:01 ~ 10:59')
    // 다른 메타 줄·본문은 그대로
    expect(r.body).toContain('- **날짜**: 2026-07-15')
    expect(r.body).toContain('## AI 회의록')
  })

  it('자정을 넘는 시각은 각 시각 독립적으로 mod 24 (23:58→08:58, 00:42→09:42)', () => {
    const r = correctMinuteBodyTime(toolBody('23:58 ~ 00:42'))
    expect(r.corrected).toBe(true)
    expect(r.to).toBe('08:58 ~ 09:42')
    expect(r.body).toContain('- **시간**: 08:58 ~ 09:42')
  })

  it('4-마커 서명이 없으면(손작성 md) 무변경', () => {
    const hand = '# 회의 메모\n\n- **시간**: 00:01 ~ 01:59\n\n내용만 있음'
    const r = correctMinuteBodyTime(hand)
    expect(r.corrected).toBe(false)
    expect(r.body).toBe(hand)
    expect(r.from).toBeUndefined()
  })

  it('서명은 있으나 시간 줄이 없으면 무변경', () => {
    const body = [
      '# 제목', '', '- **날짜**: 2026-07-15', '- **상태**: 완료', '- **생성자**: 관리자', '', '## AI 회의록',
    ].join('\n')
    const r = correctMinuteBodyTime(body)
    expect(r.corrected).toBe(false)
    expect(r.body).toBe(body)
  })

  it('빈/널 본문도 안전', () => {
    expect(correctMinuteBodyTime('').corrected).toBe(false)
    expect(correctMinuteBodyTime('').body).toBe('')
  })
})
