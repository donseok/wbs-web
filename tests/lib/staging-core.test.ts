// tests/lib/staging-core.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseDsnRef, assertStagingWritable, authTokenFixSql, detectEnvTarget, maskDsn,
} from '../../scripts/lib/staging-core.mjs'

const cfg = { stagingRef: 'stgrefstgrefstgrefst', prodRef: 'rglfgrwwwwdqejohdnty' }
const dsn = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`

describe('parseDsnRef', () => {
  it('풀러 사용자명에서 ref를 뽑는다', () => {
    expect(parseDsnRef(dsn(cfg.stagingRef))).toBe(cfg.stagingRef)
    expect(parseDsnRef(`postgresql://staging_reader.${cfg.prodRef}:pw@h:5432/postgres`)).toBe(cfg.prodRef)
  })
  it('직결 호스트에서도 ref를 뽑는다', () => {
    expect(parseDsnRef(`postgresql://postgres:pw@db.${cfg.stagingRef}.supabase.co:5432/postgres`)).toBe(cfg.stagingRef)
  })
  it('못 찾으면 null', () => { expect(parseDsnRef('postgresql://x:y@localhost:5432/db')).toBeNull() })
})

describe('assertStagingWritable — 안전장치의 본체(§6.2)', () => {
  it('스테이징 ref면 통과', () => { expect(() => assertStagingWritable(dsn(cfg.stagingRef), cfg)).not.toThrow() })
  it('운영 ref면 무조건 거부', () => { expect(() => assertStagingWritable(dsn(cfg.prodRef), cfg)).toThrow(/운영/) })
  it('ref 판독 불가면 fail-closed', () => { expect(() => assertStagingWritable('postgresql://x:y@localhost/db', cfg)).toThrow() })
})

describe('authTokenFixSql', () => {
  it('공식 확인된 4개 토큰 컬럼을 전부 다룬다', () => {
    const sql = authTokenFixSql()
    for (const col of ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change']) {
      expect(sql).toContain(col)
    }
    expect(sql).toMatch(/coalesce/i)
  })
})

describe('detectEnvTarget', () => {
  it('운영 URL이면 prod', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=https://${cfg.prodRef}.supabase.co`, cfg)).toBe('prod')
  })
  it('스테이징 URL이면 staging', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=https://${cfg.stagingRef}.supabase.co`, cfg)).toBe('staging')
  })
  it('둘 다 아니면 unknown (fail-closed 판정은 호출부 몫)', () => {
    expect(detectEnvTarget('NEXT_PUBLIC_SUPABASE_URL=https://other.supabase.co', cfg)).toBe('unknown')
  })
})

describe('maskDsn', () => {
  it('비밀번호를 가린다', () => {
    expect(maskDsn(dsn(cfg.stagingRef))).not.toContain(':pw@')
    expect(maskDsn(dsn(cfg.stagingRef))).toContain('***')
  })
})
