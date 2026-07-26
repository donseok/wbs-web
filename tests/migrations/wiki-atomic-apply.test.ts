import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0046_wiki_atomic_apply.sql', import.meta.url),
  'utf8',
)
const rollback = readFileSync(
  new URL('../../supabase/migrations/0046_wiki_atomic_apply_rollback.sql', import.meta.url),
  'utf8',
)

describe('0046 Wiki 원자 반영 migration 계약', () => {
  it('지식 키 잠금, stale current 재검증, source/event 멱등성을 한 RPC에 둔다', () => {
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain("errcode = '40001'")
    expect(migration).toContain('p_expected_current_id')
    expect(migration).toContain('p_expected_current_hash')
    expect(migration).toContain('wiki_item_sources_source_unique')
    expect(migration).toContain('retracted_at = null')
    expect(migration).toContain('wiki_change_events_idempotency_uidx')
  })

  it('atomic mutation은 정확한 minute job lease와 apply generation을 DB에서 fence한다', () => {
    expect(migration).toContain('p_wiki_job_id bigint')
    expect(migration).toContain('p_job_locked_by text')
    expect(migration).toContain('p_apply_generation integer')
    expect(migration).toMatch(
      /job\.id = p_wiki_job_id[\s\S]*job\.status = 'running'[\s\S]*job\.locked_by = p_job_locked_by[\s\S]*job\.apply_generation = p_apply_generation[\s\S]*for share;/,
    )
    expect(migration).toContain(
      "raise exception 'WIKI_JOB_LEASE_LOST' using errcode = '40001'",
    )
    expect(migration).toMatch(
      /v_latest_version_no > p_minute_version_no\s+and v_latest_body_hash is distinct from p_body_hash/,
    )
    expect(migration).toMatch(
      /from public\.wiki_project_rebuild_jobs rebuild[\s\S]*for share;[\s\S]*v_rebuild\.step_wiki_job_id = p_wiki_job_id[\s\S]*v_rebuild\.step_wiki_apply_generation = p_apply_generation/,
    )
    expect(migration).toContain(
      "raise exception 'WIKI_PROJECT_REBUILD_FENCE' using errcode = '40001'",
    )
  })

  it('rebuild generation 시작은 unlocked AI current만 한 번 soft-reset하고 수동 지식은 보존한다', () => {
    expect(migration).toContain(
      'if v_rebuild.reset_generation is distinct from v_rebuild.generation then',
    )
    expect(migration).toContain("item.origin = 'ai'")
    expect(migration).toContain('not item.auto_update_locked')
    expect(migration).toContain(
      "item.lifecycle_state in ('active', 'open', 'conflicted')",
    )
    expect(migration).toContain("set lifecycle_state = 'archived'")
    expect(migration).toContain('reset_generation = rebuild.generation')
    expect(migration).toContain("'wiki-project-reset-v1:'")
    expect(migration).toMatch(
      /if v_current\.origin = 'manual' then\s+v_can_auto := false;/,
    )
  })

  it('statement hash는 앱 정규화와 충돌하는 원문 재해시 대신 16진 wire format만 검증한다', () => {
    expect(migration).toContain("p_statement_hash !~ '^[0-9a-f]{16}$'")
    expect(migration).not.toContain(
      'p_statement_hash is distinct from public.wiki_fnv1a64(p_statement)',
    )
  })

  it('supersede 종료 시점은 처리 시각이 아닌 validFrom 또는 observedAt을 사용한다', () => {
    expect(migration).toContain('v_close_at timestamptz := coalesce(p_valid_from, p_observed_at)')
    expect(migration).toContain('valid_to = v_close_at')
  })

  it('force 요청과 worker finish를 같은 job row lock으로 직렬화한다', () => {
    expect(migration).toContain('add column if not exists apply_generation integer')
    expect(migration).toContain('add column if not exists rerun_requested boolean')
    expect(migration).toContain('create or replace function public.request_wiki_processing_job_run')
    expect(migration).toContain('create or replace function public.finish_wiki_processing_job')
    expect(migration).toContain("case when v_job.status = 'running' then true else false end")
    expect(migration).toContain('if v_job.rerun_requested then')
    expect(migration.match(/where job\.id = p_job_id[\s\S]*?for update;/g)).toHaveLength(2)
  })

  it('롤백은 RPC와 추가한 event·queue 계약을 대칭적으로 제거한다', () => {
    expect(rollback).toContain('drop function if exists public.apply_wiki_extracted_item_atomic')
    expect(rollback).toContain('drop function if exists public.finish_wiki_processing_job')
    expect(rollback).toContain('drop function if exists public.request_wiki_processing_job_run')
    expect(rollback).toContain('drop index if exists public.wiki_change_events_idempotency_uidx')
    expect(rollback).toContain('drop column if exists idempotency_key')
    expect(rollback).toContain('drop column if exists rerun_requested')
    expect(rollback).toContain('drop column if exists apply_generation')
    expect(rollback).not.toContain('drop table')
  })
})
