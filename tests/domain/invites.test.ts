import { describe, it, expect } from 'vitest'
import {
  isInviteToken, normalizeInviteEmail, parseAllowedDomains, isAllowedInviteDomain,
  DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, normalizeInviteDays,
  inviteStatus, inviteStatusLabel, maskEmail, validateSignupInput,
  type InviteStateRow,
} from '@/lib/domain/invites'

const TOKEN = '3f0f5f8e-1b2c-4d5e-8a9b-0c1d2e3f4a5b'

describe('isInviteToken', () => {
  it('UUID 형식만 통과(대문자 허용)', () => {
    expect(isInviteToken(TOKEN)).toBe(true)
    expect(isInviteToken(TOKEN.toUpperCase())).toBe(true)
  })
  it('비-UUID는 거부 — DB 조회 전 차단', () => {
    expect(isInviteToken('not-a-uuid')).toBe(false)
    expect(isInviteToken('')).toBe(false)
    expect(isInviteToken(TOKEN.slice(0, -1))).toBe(false)
    expect(isInviteToken(TOKEN + 'a')).toBe(false)
    expect(isInviteToken(` ${TOKEN} `)).toBe(false) // 공백 포함은 그대로 거부(정규화하지 않는다)
  })
})

describe('normalizeInviteEmail', () => {
  it('소문자·trim — DB check(email = lower(btrim(email)))와 같은 규칙', () => {
    expect(normalizeInviteEmail('  Nam.YU@Dongkuk.com \n')).toBe('nam.yu@dongkuk.com')
    expect(normalizeInviteEmail('a@b.com')).toBe('a@b.com')
    expect(normalizeInviteEmail('   ')).toBe('')
  })
})

describe('parseAllowedDomains', () => {
  it('쉼표·공백 구분, 소문자, 중복 제거', () => {
    expect(parseAllowedDomains('Dongkuk.com, dkchem.co.kr')).toEqual(['dongkuk.com', 'dkchem.co.kr'])
    expect(parseAllowedDomains('a.com  b.com\tc.com')).toEqual(['a.com', 'b.com', 'c.com'])
    expect(parseAllowedDomains('a.com, A.COM')).toEqual(['a.com'])
  })
  it("'@' 접두는 떼어낸다(설정 실수 흡수)", () => {
    expect(parseAllowedDomains('@dongkuk.com')).toEqual(['dongkuk.com'])
  })
  it('빈 입력·미설정은 기본값 — 제한 없음으로 읽지 않는다(fail-closed)', () => {
    expect(parseAllowedDomains(undefined)).toEqual(['dongkuk.com'])
    expect(parseAllowedDomains('')).toEqual(['dongkuk.com'])
    expect(parseAllowedDomains('  , ,\t')).toEqual(['dongkuk.com'])
  })
})

describe('isAllowedInviteDomain', () => {
  const domains = ['dongkuk.com']
  it('정확히 일치하면 허용(대소문자 무시)', () => {
    expect(isAllowedInviteDomain('nam.yu@dongkuk.com', domains)).toBe(true)
    expect(isAllowedInviteDomain('nam.yu@DONGKUK.com', domains)).toBe(true)
    expect(isAllowedInviteDomain('a@b.com', ['A.COM', 'b.com'])).toBe(true)
  })
  it('서브도메인은 불허 — 사칭 도메인 차단', () => {
    expect(isAllowedInviteDomain('x@a.dongkuk.com', domains)).toBe(false)
    expect(isAllowedInviteDomain('x@dongkuk.com.evil.io', domains)).toBe(false)
    expect(isAllowedInviteDomain('x@gmail.com', domains)).toBe(false)
  })
  it("'@' 가 없거나 어느 한쪽이 비면 거부", () => {
    expect(isAllowedInviteDomain('dongkuk.com', domains)).toBe(false)
    expect(isAllowedInviteDomain('@dongkuk.com', domains)).toBe(false)
    expect(isAllowedInviteDomain('x@', domains)).toBe(false)
    expect(isAllowedInviteDomain('', domains)).toBe(false)
  })
  it('빈 목록이면 어떤 주소도 통과하지 못한다', () => {
    expect(isAllowedInviteDomain('x@dongkuk.com', [])).toBe(false)
  })
})

describe('normalizeInviteDays', () => {
  it('기본·최대 상수', () => {
    expect(DEFAULT_INVITE_DAYS).toBe(7)
    expect(MAX_INVITE_DAYS).toBe(30)
  })
  it('1~30 정수는 통과', () => {
    expect(normalizeInviteDays(1)).toBe(1)
    expect(normalizeInviteDays(7)).toBe(7)
    expect(normalizeInviteDays(30)).toBe(30)
  })
  it('범위 밖은 null', () => {
    expect(normalizeInviteDays(0)).toBeNull()
    expect(normalizeInviteDays(31)).toBeNull()
    expect(normalizeInviteDays(-1)).toBeNull()
  })
  it('비정수·비수치는 null', () => {
    expect(normalizeInviteDays(7.5)).toBeNull()
    expect(normalizeInviteDays(Number.NaN)).toBeNull()
    expect(normalizeInviteDays(Infinity)).toBeNull()
    expect(normalizeInviteDays(undefined)).toBeNull()
    expect(normalizeInviteDays(null)).toBeNull()
    expect(normalizeInviteDays({})).toBeNull()
    expect(normalizeInviteDays(true)).toBeNull()
  })
  it('폼이 보내는 십진 정수 문자열은 받는다', () => {
    expect(normalizeInviteDays('7')).toBe(7)
    expect(normalizeInviteDays(' 30 ')).toBe(30)
  })
  it('정수 문자열이 아니면 null', () => {
    expect(normalizeInviteDays('7.5')).toBeNull()
    expect(normalizeInviteDays('-1')).toBeNull()
    expect(normalizeInviteDays('')).toBeNull()
    expect(normalizeInviteDays('   ')).toBeNull()
    expect(normalizeInviteDays('7일')).toBeNull()
    expect(normalizeInviteDays('0')).toBeNull()
    expect(normalizeInviteDays('31')).toBeNull()
  })
})

describe('inviteStatus', () => {
  const now = new Date('2026-08-03T00:00:00.000Z')
  const row = (o: Partial<InviteStateRow> = {}): InviteStateRow => ({
    expiresAt: '2026-08-10T00:00:00.000Z', revokedAt: null, redeemedAt: null, ...o,
  })

  it('기본은 active', () => {
    expect(inviteStatus(row(), now)).toBe('active')
  })
  it('우선순위: revoked > redeemed > expired > active', () => {
    // 넷이 동시에 성립해도 revoked 가 이긴다.
    expect(inviteStatus(row({
      revokedAt: '2026-08-02T00:00:00.000Z',
      redeemedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }), now)).toBe('revoked')
    expect(inviteStatus(row({
      redeemedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }), now)).toBe('redeemed')
    expect(inviteStatus(row({ expiresAt: '2026-08-01T00:00:00.000Z' }), now)).toBe('expired')
  })
  it('만료 경계 — 정확히 now 는 만료(소비 RPC 의 expires_at > now() 와 동일)', () => {
    expect(inviteStatus(row({ expiresAt: now.toISOString() }), now)).toBe('expired')
    expect(inviteStatus(row({ expiresAt: new Date(now.getTime() + 1).toISOString() }), now)).toBe('active')
    expect(inviteStatus(row({ expiresAt: new Date(now.getTime() - 1).toISOString() }), now)).toBe('expired')
  })
  it('expiresAt 파싱 실패는 expired — fail-closed', () => {
    expect(inviteStatus(row({ expiresAt: 'not-a-date' }), now)).toBe('expired')
    expect(inviteStatus(row({ expiresAt: '' }), now)).toBe('expired')
  })
  it('파싱 실패여도 revoked·redeemed 가 우선한다', () => {
    expect(inviteStatus(row({ expiresAt: 'x', revokedAt: '2026-08-02T00:00:00.000Z' }), now)).toBe('revoked')
    expect(inviteStatus(row({ expiresAt: 'x', redeemedAt: '2026-08-02T00:00:00.000Z' }), now)).toBe('redeemed')
  })
})

describe('inviteStatusLabel', () => {
  it('상태별 한국어 라벨', () => {
    expect(inviteStatusLabel('active')).toBe('유효')
    expect(inviteStatusLabel('redeemed')).toBe('합류 완료')
    expect(inviteStatusLabel('revoked')).toBe('취소됨')
    expect(inviteStatusLabel('expired')).toBe('만료됨')
  })
})

describe('maskEmail', () => {
  it('로컬파트 앞 2자만 남긴다', () => {
    expect(maskEmail('nam.yu@dongkuk.com')).toBe('na****@dongkuk.com')
    expect(maskEmail('abc@dongkuk.com')).toBe('ab*@dongkuk.com')
  })
  it('대문자·공백은 정규화 후 마스킹', () => {
    expect(maskEmail('  Nam.YU@Dongkuk.com ')).toBe('na****@dongkuk.com')
  })
  it('로컬파트 2자 이하는 첫 1자만 — 별표는 최소 1개', () => {
    expect(maskEmail('ab@dongkuk.com')).toBe('a*@dongkuk.com')
    expect(maskEmail('a@dongkuk.com')).toBe('a*@dongkuk.com')
  })
  it('형식이 깨졌으면 무엇도 흘리지 않는다', () => {
    expect(maskEmail('dongkuk.com')).toBe('***')
    expect(maskEmail('@dongkuk.com')).toBe('***')
    expect(maskEmail('abc@')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })
})

describe('validateSignupInput', () => {
  const ok = { name: '홍길동', password: 'password1', passwordConfirmation: 'password1' }
  it('정상 입력', () => {
    expect(validateSignupInput(ok)).toEqual({ ok: true })
  })
  it('이름 공백은 E6', () => {
    expect(validateSignupInput({ ...ok, name: '   ' })).toEqual({ ok: false, error: '이름을 입력해 주세요.' })
  })
  it('비밀번호 8자 미만은 E7 — 7자 거부, 8자 통과', () => {
    expect(validateSignupInput({ ...ok, password: '1234567', passwordConfirmation: '1234567' }))
      .toEqual({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' })
    expect(validateSignupInput({ ...ok, password: '12345678', passwordConfirmation: '12345678' }))
      .toEqual({ ok: true })
  })
  it('비밀번호 불일치는 E8', () => {
    expect(validateSignupInput({ ...ok, passwordConfirmation: 'password2' }))
      .toEqual({ ok: false, error: '비밀번호가 일치하지 않습니다.' })
  })
  it('형상이 어긋난 입력은 TypeError 없이 거부 — 공개 액션의 첫 관문', () => {
    // 인증 게이트가 없어 조작된 요청이 그대로 들어온다. 던지지 말고 판정으로 끝내야 한다.
    const bad = (v: unknown) => validateSignupInput(v as never)
    const shapeErr = { ok: false, error: '입력값을 확인해 주세요.' }
    expect(bad(null)).toEqual(shapeErr)
    expect(bad(undefined)).toEqual(shapeErr)
    expect(bad({})).toEqual(shapeErr)
    expect(bad({ name: 1, password: 'password1', passwordConfirmation: 'password1' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 12345678, passwordConfirmation: 'password1' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 'password1', passwordConfirmation: null })).toEqual(shapeErr)
    // 필드 일부 누락
    expect(bad({ name: '홍길동' })).toEqual(shapeErr)
    expect(bad({ name: '홍길동', password: 'password1' })).toEqual(shapeErr)
    expect(bad({ password: 'password1', passwordConfirmation: 'password1' })).toEqual(shapeErr)
    // 객체가 아닌 값
    expect(bad('홍길동')).toEqual(shapeErr)
    expect(bad(0)).toEqual(shapeErr)
  })
  it('이메일은 검증 대상이 아니다 — 초대 행이 정한다(폼에 입력란 없음)', () => {
    // 이름·비밀번호만으로 통과해야 한다. 이메일 필드 자체가 SignupInput 에 없다.
    expect(Object.keys(ok)).toEqual(['name', 'password', 'passwordConfirmation'])
  })
})
