import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0047_wiki_processing_job_claim.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL(
    '../../supabase/migrations/0047_wiki_processing_job_claim_rollback.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('0047 Wiki minute job DB 시각 선점 migration 계약', () => {
  it('due 판정과 pending → running 선점을 한 DB update에서 수행한다', () => {
    expect(migration).toContain(
      'create or replace function public.claim_wiki_processing_job',
    )
    expect(migration).toContain('v_now timestamptz := clock_timestamp()')
    expect(migration).toMatch(
      /update public\.wiki_processing_jobs job[\s\S]*status = 'running'[\s\S]*attempts = job\.attempts \+ 1[\s\S]*job\.status = 'pending'[\s\S]*job\.run_after <= v_now[\s\S]*returning job\.\* into v_job;/,
    )
    expect(migration).toContain(
      'grant execute on function public.claim_wiki_processing_job(bigint, text)',
    )
  })

  it('롤백은 선점 RPC만 대칭적으로 제거한다', () => {
    expect(rollback).toContain(
      'drop function if exists public.claim_wiki_processing_job(bigint, text)',
    )
  })
})
