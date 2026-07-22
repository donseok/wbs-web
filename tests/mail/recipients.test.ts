import { describe, it, expect } from 'vitest'
import type { MeetingAttendeeInfo } from '@/lib/domain/types'
import { classifyRecipients } from '@/lib/mail/recipients'

function att(name: string, email: string | null): MeetingAttendeeInfo {
  return { id: `id-${name}`, name, teamCode: null, email }
}

describe('classifyRecipients', () => {
  it('정상 이메일은 valid 로 분류한다', () => {
    const res = classifyRecipients([att('김철수', 'chulsoo@dongkuk.com')])
    expect(res.valid).toEqual([{ name: '김철수', email: 'chulsoo@dongkuk.com' }])
    expect(res.skipped).toEqual([])
  })

  it('null 이메일은 no_email 로 제외한다', () => {
    const res = classifyRecipients([att('박영희', null)])
    expect(res.valid).toEqual([])
    expect(res.skipped).toEqual([{ name: '박영희', reason: 'no_email' }])
  })

  it('공백뿐인 이메일도 no_email 로 제외한다', () => {
    const res = classifyRecipients([att('이민수', '   ')])
    expect(res.skipped).toEqual([{ name: '이민수', reason: 'no_email' }])
  })

  it('형식이 깨진 이메일은 invalid_email 로 제외한다 — 0011 백필 미실행 대비', () => {
    const broken = ['no-at-sign', 'a@b', 'a@@b.com', 'a b@c.com', '@dongkuk.com', 'a@.com']
    const res = classifyRecipients(broken.map((e, i) => att(`X${i}`, e)))
    expect(res.valid).toEqual([])
    expect(res.skipped.every(s => s.reason === 'invalid_email')).toBe(true)
    expect(res.skipped).toHaveLength(broken.length)
  })

  it('SMTP 에서 깨지는 문자가 든 주소를 invalid_email 로 제외한다', () => {
    const bad = ['a@ev,il.com', 'chulsoo@dongkuk,co.kr', 'a;b@test.com', 'a<b>@test.com', 'a"b@test.com']
    const res = classifyRecipients(bad.map((e, i) => att(`Y${i}`, e)))
    expect(res.valid).toEqual([])
    expect(res.skipped).toHaveLength(bad.length)
    expect(res.skipped.every(s => s.reason === 'invalid_email')).toBe(true)
  })

  it('실제로 쓰이는 사내 주소 형태는 계속 valid 로 통과시킨다', () => {
    const good = [
      'chulsoo@dongkuk.com',
      'jihun.kim@dongkuk.co.kr',
      'jihun+test@dongkuk.com',
      'a@dong-kuk.com',
      'a_b@mail.dongkuk.com',
    ]
    const res = classifyRecipients(good.map((e, i) => att(`Z${i}`, e)))
    expect(res.skipped).toEqual([])
    expect(res.valid.map(v => v.email)).toEqual(good)
  })

  it('이메일을 소문자로 정규화하고 앞뒤 공백을 제거한다', () => {
    const res = classifyRecipients([att('최지훈', '  JiHun@Dongkuk.COM ')])
    expect(res.valid).toEqual([{ name: '최지훈', email: 'jihun@dongkuk.com' }])
  })

  it('같은 주소가 여러 번 나오면 한 번만 남긴다', () => {
    const res = classifyRecipients([att('A', 'same@dongkuk.com'), att('B', 'SAME@dongkuk.com')])
    expect(res.valid).toEqual([{ name: 'A', email: 'same@dongkuk.com' }])
    expect(res.skipped).toEqual([])
  })

  it('섞여 있어도 순서를 보존하며 분류한다', () => {
    const res = classifyRecipients([att('A', 'a@dongkuk.com'), att('B', null), att('C', 'c@dongkuk.com')])
    expect(res.valid.map(v => v.name)).toEqual(['A', 'C'])
    expect(res.skipped.map(s => s.name)).toEqual(['B'])
  })

  it('빈 배열은 빈 결과를 낸다', () => {
    expect(classifyRecipients([])).toEqual({ valid: [], skipped: [] })
  })
})
