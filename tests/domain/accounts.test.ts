import { describe, it, expect } from 'vitest'
import {
  ACCOUNT_ROLES, isTeamCode, isAccountRole, isValidPassword, parseBulkAccounts,
} from '@/lib/domain/accounts'
import { DEFAULT_TEAM_CODES } from '@/lib/domain/teams'

describe('상수/타입가드', () => {
  it('기본 팀 코드는 PMO·가공·ERP·MES·MDM', () => {
    expect([...DEFAULT_TEAM_CODES].sort()).toEqual(['ERP', 'MES', 'PMO', '가공', 'MDM'].sort())
  })
  it('권한은 admin·member·viewer — 3단 프로젝트 역할', () => {
    expect([...ACCOUNT_ROLES]).toEqual(['admin', 'member', 'viewer'])
  })
  it('isTeamCode', () => {
    expect(isTeamCode('PMO', DEFAULT_TEAM_CODES)).toBe(true)
    expect(isTeamCode('가공', DEFAULT_TEAM_CODES)).toBe(true)
    expect(isTeamCode('DT', DEFAULT_TEAM_CODES)).toBe(false)
    expect(isTeamCode('', DEFAULT_TEAM_CODES)).toBe(false)
  })
  it('isAccountRole — 새 3단 값만 허용, 옛 값은 거부', () => {
    expect(isAccountRole('admin')).toBe(true)
    expect(isAccountRole('member')).toBe(true)
    expect(isAccountRole('viewer')).toBe(true)
    // 옛 값을 조용히 허용하면 예전 일괄 등록 파일이 그대로 통과해 잘못된 권한이 만들어진다.
    expect(isAccountRole('pmo_admin')).toBe(false)
    expect(isAccountRole('team_editor')).toBe(false)
  })
})

describe('isValidPassword', () => {
  it('8자 이상은 true', () => {
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('a-long-password')).toBe(true)
  })
  it('8자 미만/비문자열은 false', () => {
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('')).toBe(false)
    expect(isValidPassword(undefined)).toBe(false) // 런타임 방어(unknown 허용)
  })
})

describe('parseBulkAccounts', () => {
  it('정상 4열(콤마)', () => {
    const r = parseBulkAccounts('a@b.com, PMO, member, password1', DEFAULT_TEAM_CODES)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ lineNo: 1, ok: true, email: 'a@b.com', teamCode: 'PMO', role: 'member', password: 'password1', name: null })
  })
  it('정상 5열(이름 포함)', () => {
    const r = parseBulkAccounts('a@b.com,가공,admin,password1,홍길동', DEFAULT_TEAM_CODES)
    expect(r[0]).toMatchObject({ ok: true, teamCode: '가공', role: 'admin', name: '홍길동' })
  })
  it('탭 구분(엑셀 붙여넣기)도 허용', () => {
    const r = parseBulkAccounts('a@b.com\tMES\tmember\tpassword1', DEFAULT_TEAM_CODES)
    expect(r[0]).toMatchObject({ ok: true, email: 'a@b.com', teamCode: 'MES' })
  })
  it('빈 줄은 건너뛰되 lineNo는 파일 행번호 유지', () => {
    const r = parseBulkAccounts('\n\na@b.com,PMO,member,password1\n', DEFAULT_TEAM_CODES)
    expect(r).toHaveLength(1)
    expect(r[0].lineNo).toBe(3)
  })
  it('열 부족은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, member', DEFAULT_TEAM_CODES)
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('열')
  })
  it('이메일 형식 오류는 실패', () => {
    const r = parseBulkAccounts('not-an-email, PMO, member, password1', DEFAULT_TEAM_CODES)
    expect(r[0]).toMatchObject({ ok: false })
    expect(r[0].error).toContain('이메일')
  })
  it('알 수 없는 팀은 실패', () => {
    const r = parseBulkAccounts('a@b.com, DT, member, password1', DEFAULT_TEAM_CODES)
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('팀')
  })
  it('알 수 없는 권한은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, superuser, password1', DEFAULT_TEAM_CODES)
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('권한')
  })
  it('옛 포맷(pmo_admin·team_editor)은 사유를 밝히며 거부한다', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor, password1', DEFAULT_TEAM_CODES)
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('team_editor')
    expect(r[0].error).toContain('옛 권한 값')
  })
  it('짧은 비밀번호는 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, member, short', DEFAULT_TEAM_CODES)
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('8자')
  })
})
