import { describe, it, expect } from 'vitest'
import type { MeetingAttendeeInfo } from '@/lib/domain/types'
import { classifyRecipients, isValidEmail, parseExtraEmails } from '@/lib/mail/recipients'

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

describe('classifyRecipients — 추가 수신 이메일', () => {
  it('추가 이메일은 참석자 뒤에 valid 로 붙고 이름 자리에 주소를 쓴다', () => {
    const res = classifyRecipients([att('김철수', 'chulsoo@dongkuk.com')], ['guest@partner.co.kr'])
    expect(res.valid).toEqual([
      { name: '김철수', email: 'chulsoo@dongkuk.com' },
      { name: 'guest@partner.co.kr', email: 'guest@partner.co.kr' },
    ])
    expect(res.skipped).toEqual([])
  })

  it('참석자 없이 추가 이메일만으로도 valid 를 만든다', () => {
    const res = classifyRecipients([], ['guest@partner.co.kr'])
    expect(res.valid).toEqual([{ name: 'guest@partner.co.kr', email: 'guest@partner.co.kr' }])
  })

  it('형식이 깨진 추가 이메일은 주소를 이름으로 invalid_email 에 보고한다', () => {
    const res = classifyRecipients([], ['not-an-email', 'a@@b.com'])
    expect(res.valid).toEqual([])
    expect(res.skipped).toEqual([
      { name: 'not-an-email', reason: 'invalid_email' },
      { name: 'a@@b.com', reason: 'invalid_email' },
    ])
  })

  it('참석자와 겹치는 추가 이메일은 참석자 것만 남긴다(대소문자 무시)', () => {
    const res = classifyRecipients([att('김철수', 'chulsoo@dongkuk.com')], ['ChulSoo@Dongkuk.COM'])
    expect(res.valid).toEqual([{ name: '김철수', email: 'chulsoo@dongkuk.com' }])
    expect(res.skipped).toEqual([])
  })

  it('추가 이메일끼리의 중복도 한 번만 남긴다', () => {
    const res = classifyRecipients([], ['g@x.com', 'G@x.com'])
    expect(res.valid).toEqual([{ name: 'g@x.com', email: 'g@x.com' }])
  })

  it('빈 문자열·공백 토큰은 보고 없이 버린다', () => {
    const res = classifyRecipients([], ['', '   '])
    expect(res).toEqual({ valid: [], skipped: [] })
  })

  it('254자를 넘는 주소는 invalid_email 로 제외한다', () => {
    const long = `${'a'.repeat(250)}@x.com`
    const res = classifyRecipients([], [long])
    expect(res.valid).toEqual([])
    expect(res.skipped).toEqual([{ name: long, reason: 'invalid_email' }])
  })
})

describe('parseExtraEmails', () => {
  it('쉼표·세미콜론·공백·줄바꿈 혼합 구분을 모두 나눈다', () => {
    expect(parseExtraEmails('a@x.com, b@y.com;c@z.com\nd@w.com e@v.com'))
      .toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com', 'e@v.com'])
  })

  it('소문자로 정규화하고 중복(대소문자 차이 포함)을 제거한다', () => {
    expect(parseExtraEmails('A@X.com, a@x.com')).toEqual(['a@x.com'])
  })

  it('빈 입력과 구분자뿐인 입력은 빈 배열을 낸다', () => {
    expect(parseExtraEmails('')).toEqual([])
    expect(parseExtraEmails(' ,, ;\n ')).toEqual([])
  })

  it('유효성 판정은 하지 않는다 — 깨진 토큰도 그대로 내보낸다(isValidEmail 이 가른다)', () => {
    const out = parseExtraEmails('good@x.com, broken')
    expect(out).toEqual(['good@x.com', 'broken'])
    expect(out.filter(isValidEmail)).toEqual(['good@x.com'])
  })
})
