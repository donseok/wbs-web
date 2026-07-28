import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const migration = readFileSync(`${migrationsDir}0050_migration_ledger.sql`, 'utf8')
const rollback = readFileSync(`${migrationsDir}0050_migration_ledger_rollback.sql`, 'utf8')

describe('0050 마이그레이션 적용 원장', () => {
  it('멱등하게 작성됐다', () => {
    expect(migration).toContain('create table if not exists public.migration_ledger')
    expect(migration).toContain('create index if not exists migration_ledger_applied_at_idx')
  })

  it('앱 런타임에 노출되지 않는다 — service_role 전용', () => {
    expect(migration).toContain('alter table public.migration_ledger enable row level security')
    expect(migration).toContain(
      'revoke all on table public.migration_ledger from public, anon, authenticated',
    )
    expect(migration).toContain('grant all on table public.migration_ledger to service_role')
    // authenticated 에 select 를 열면 운영 도구 전용이라는 계약이 깨진다.
    expect(migration).not.toMatch(/grant\s+select[^;]*to\s+authenticated/i)
  })

  it('checksum 은 sha256 hex 만 받는다', () => {
    expect(migration).toContain("check (checksum ~ '^[0-9a-f]{64}$')")
  })

  it('filename 이 기본키다 — 같은 파일이 두 번 기록될 수 없다', () => {
    expect(migration).toMatch(/filename\s+text primary key/)
  })

  it('롤백이 표와 인덱스를 모두 정리하고 데이터 소실을 경고한다', () => {
    expect(rollback).toContain('drop table if exists public.migration_ledger')
    expect(rollback).toContain('drop index if exists public.migration_ledger_applied_at_idx')
    expect(rollback).toMatch(/경고/)
  })
})

describe('마이그레이션 롤백 파일 커버리지', () => {
  // 정방향 47개 중 27개가 롤백 파일 없이 적용돼 있다(2026-07-28 기준). 과거분을 지금
  // 소급해 쓰는 것은 현실적이지 않지만, 부채가 더 늘어나는 것은 여기서 막는다.
  const FROM = 50

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  const forward = files.filter((f) => !f.endsWith('_rollback.sql'))

  it(`${String(FROM).padStart(4, '0')} 이후 마이그레이션에는 _rollback.sql 이 함께 있다`, () => {
    const missing = forward
      .filter((f) => Number(f.slice(0, 4)) >= FROM)
      .filter((f) => !files.includes(f.replace(/\.sql$/, '_rollback.sql')))
    expect(
      missing,
      '새 마이그레이션에는 역방향 SQL 을 함께 만드세요. 롤백 파일이 없으면 코드만 되돌리는 반쪽 롤백밖에 못 합니다.',
    ).toEqual([])
  })

  it('롤백 파일은 대응하는 정방향 파일이 있다', () => {
    const orphans = files
      .filter((f) => f.endsWith('_rollback.sql'))
      .filter((f) => !files.includes(f.replace(/_rollback\.sql$/, '.sql')))
    expect(orphans).toEqual([])
  })
})
