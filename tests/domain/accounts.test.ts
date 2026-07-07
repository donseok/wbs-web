import { describe, it, expect } from 'vitest'
import {
  TEAM_CODES, ACCOUNT_ROLES, isTeamCode, isAccountRole, isValidPassword, parseBulkAccounts,
} from '@/lib/domain/accounts'

describe('상수/타입가드', () => {
  it('팀 코드는 PMO·가공·ERP·MES', () => {
    expect([...TEAM_CODES].sort()).toEqual(['ERP', 'MES', 'PMO', '가공'].sort())
  })
  it('권한은 pmo_admin·team_editor', () => {
    expect([...ACCOUNT_ROLES].sort()).toEqual(['pmo_admin', 'team_editor'])
  })
  it('isTeamCode', () => {
    expect(isTeamCode('PMO')).toBe(true)
    expect(isTeamCode('가공')).toBe(true)
    expect(isTeamCode('DT')).toBe(false)
    expect(isTeamCode('')).toBe(false)
  })
  it('isAccountRole', () => {
    expect(isAccountRole('pmo_admin')).toBe(true)
    expect(isAccountRole('team_editor')).toBe(true)
    expect(isAccountRole('admin')).toBe(false)
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
    // @ts-expect-error 런타임 방어 확인
    expect(isValidPassword(undefined)).toBe(false)
  })
})

describe('parseBulkAccounts', () => {
  it('정상 4열(콤마)', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor, password1')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ lineNo: 1, ok: true, email: 'a@b.com', teamCode: 'PMO', role: 'team_editor', password: 'password1', name: null })
  })
  it('정상 5열(이름 포함)', () => {
    const r = parseBulkAccounts('a@b.com,가공,pmo_admin,password1,홍길동')
    expect(r[0]).toMatchObject({ ok: true, teamCode: '가공', role: 'pmo_admin', name: '홍길동' })
  })
  it('탭 구분(엑셀 붙여넣기)도 허용', () => {
    const r = parseBulkAccounts('a@b.com\tMES\tteam_editor\tpassword1')
    expect(r[0]).toMatchObject({ ok: true, email: 'a@b.com', teamCode: 'MES' })
  })
  it('빈 줄은 건너뛰되 lineNo는 파일 행번호 유지', () => {
    const r = parseBulkAccounts('\n\na@b.com,PMO,team_editor,password1\n')
    expect(r).toHaveLength(1)
    expect(r[0].lineNo).toBe(3)
  })
  it('열 부족은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('열')
  })
  it('이메일 형식 오류는 실패', () => {
    const r = parseBulkAccounts('not-an-email, PMO, team_editor, password1')
    expect(r[0]).toMatchObject({ ok: false })
    expect(r[0].error).toContain('이메일')
  })
  it('알 수 없는 팀은 실패', () => {
    const r = parseBulkAccounts('a@b.com, DT, team_editor, password1')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('팀')
  })
  it('알 수 없는 권한은 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, superuser, password1')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('권한')
  })
  it('짧은 비밀번호는 실패', () => {
    const r = parseBulkAccounts('a@b.com, PMO, team_editor, short')
    expect(r[0].ok).toBe(false)
    expect(r[0].error).toContain('8자')
  })
})
