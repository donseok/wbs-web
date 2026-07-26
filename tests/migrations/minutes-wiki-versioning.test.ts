import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/0045_minutes_wiki.sql', import.meta.url),
  'utf8',
)
const atomicMigration = readFileSync(
  new URL('../../supabase/migrations/0046_wiki_atomic_apply.sql', import.meta.url),
  'utf8',
)
const wikiIngestSource = readFileSync(
  new URL('../../src/lib/ai/wiki-ingest.ts', import.meta.url),
  'utf8',
)

function functionSql(name: string, nextMarker: string): string {
  const start = migration.indexOf(`create or replace function public.${name}`)
  const end = migration.indexOf(nextMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('0045 회의록 불변 버전과 Wiki 철회 계약', () => {
  it('본문 내용이 달라진 commit은 새 버전과 같은 트랜잭션에서 이전 Wiki 근거를 먼저 철회한다', () => {
    const commit = functionSql(
      'commit_minute_body_version',
      'revoke all on function public.commit_minute_body_version',
    )

    expect(commit).toContain('wiki_rebuild_required boolean')
    expect(commit).toMatch(
      /wiki_rebuild_required :=\s*v_metadata_rebuild_required\s+or v_body_changed/,
    )
    const retract = commit.indexOf('from public.retract_minute_wiki_sources(')
    const append = commit.indexOf('insert into public.minute_versions as new_version')
    expect(retract).toBeGreaterThanOrEqual(0)
    expect(append).toBeGreaterThan(retract)
  })

  it('버전 행과 그 버전이 참조하는 Storage 원본은 직접 변경·삭제할 수 없다', () => {
    expect(migration).toContain('MINUTE_VERSION_IMMUTABLE')
    expect(migration).toContain(
      'before update or delete on public.minute_versions',
    )
    expect(migration).toMatch(
      /not exists \([\s\S]*select 1\s+from public\.minute_versions mv\s+where mv\.file_path = storage\.objects\.name/,
    )
  })

  it('사용자 삭제는 hard delete 대신 archive RPC이며 원본 버전·파일을 지우지 않는다', () => {
    const archive = functionSql(
      'archive_minute_with_wiki_retraction',
      'revoke all on function public.archive_minute_with_wiki_retraction',
    )

    expect(archive).toContain('set archived_at = coalesce(mi.archived_at, v_now)')
    expect(archive).not.toContain('delete from public.minute_versions')
    expect(archive).not.toContain('delete from public.minute_files')
    expect(archive).not.toMatch(/delete from public\.minutes\b/)
  })

  it('프로젝트 이동은 모든 이전 색인 scope에 delete를 남기고 새 scope에 upsert를 남긴다', () => {
    const metadata = functionSql(
      'update_minute_metadata_with_wiki_retraction',
      'revoke all on function public.update_minute_metadata_with_wiki_retraction',
    )

    expect(metadata).toMatch(
      /delete from public\.ai_documents\s+where domain = 'minutes'[\s\S]*entity_id = p_minute_id::text/,
    )
    expect(metadata).toMatch(
      /select job\.project_id[\s\S]*from public\.ai_index_jobs job[\s\S]*union all\s+select old_project_id/,
    )
    const oldScopeDelete = metadata.search(
      /perform public\.queue_minute_ai_index_scope_change\(\s*v_index_project_id,\s*p_minute_id,\s*'delete'/,
    )
    const newScopeUpsert = metadata.search(
      /perform public\.queue_minute_ai_index_scope_change\(\s*new_project_id,\s*p_minute_id,\s*'upsert'/,
    )
    expect(oldScopeDelete).toBeGreaterThanOrEqual(0)
    expect(newScopeUpsert).toBeGreaterThan(oldScopeDelete)
    expect(metadata).toContain('project_id NULL도 검색 계층의 명시적 global scope')
  })

  it('lease가 만료된 구세대 색인 worker도 현재 회의록 scope 밖 문서를 쓸 수 없다', () => {
    const guard = functionSql(
      'guard_minute_ai_document_scope',
      'drop trigger if exists ai_documents_minute_scope_guard_trg',
    )

    expect(guard).toContain("new.domain <> 'minutes'")
    expect(guard).toContain('v_archived_at is not null')
    expect(guard).toContain(
      'v_minute_project_id is distinct from new.project_id',
    )
    expect(guard).toMatch(
      /where minute\.id = new\.entity_id::uuid[\s\S]*for share nowait;/,
    )
    expect(guard).toContain('AI_MINUTE_DOCUMENT_SCOPE_MISMATCH')
    expect(migration).toMatch(
      /create trigger ai_documents_minute_scope_guard_trg\s+before insert or update on public\.ai_documents/,
    )
  })

  it('본문 변경·보관·프로젝트 이동은 같은 트랜잭션에 durable Wiki rebuild를 요청한다', () => {
    const request = functionSql(
      'request_wiki_project_rebuild',
      'revoke all on function public.request_wiki_project_rebuild',
    )
    const retract = functionSql(
      'retract_minute_wiki_sources',
      'revoke all on function public.retract_minute_wiki_sources',
    )
    const metadata = functionSql(
      'update_minute_metadata_with_wiki_retraction',
      'revoke all on function public.update_minute_metadata_with_wiki_retraction',
    )
    const commit = functionSql(
      'commit_minute_body_version',
      'revoke all on function public.commit_minute_body_version',
    )
    const archive = functionSql(
      'archive_minute_with_wiki_retraction',
      'revoke all on function public.archive_minute_with_wiki_retraction',
    )

    // 단순 after() 예약이 아니라 프로젝트 orchestration queue에 pending 요청을 upsert한다.
    expect(request).toContain('insert into public.wiki_project_rebuild_jobs as rebuild')
    expect(request).toContain("'pending'")
    expect(request).toContain('on conflict (project_id) do update set')
    expect(request).toContain('generation = rebuild.generation + 1')

    // 철회 RPC가 old scope 요청을 함께 커밋하므로 본문 변경·보관·이동 모두 이 경로를 탄다.
    expect(retract).toMatch(
      /perform public\.request_wiki_project_rebuild\(v_project_id, v_reason\)/,
    )
    expect(commit).toMatch(
      /v_body_changed := v_current_hash is distinct from p_body_hash;[\s\S]*if v_body_changed then[\s\S]*from public\.retract_minute_wiki_sources\(/,
    )
    expect(archive).toMatch(/from public\.retract_minute_wiki_sources\(/)
    expect(metadata).toMatch(/from public\.retract_minute_wiki_sources\(/)
    // 프로젝트 이동은 update 뒤 새 scope도 별도 generation으로 요청한다.
    expect(metadata).toMatch(
      /perform public\.request_wiki_project_rebuild\(\s*new_project_id/,
    )
  })

  it('날짜 이동과 모든 프로젝트 회의록 생성은 ordered keyset generation을 요청한다', () => {
    const metadata = functionSql(
      'update_minute_metadata_with_wiki_retraction',
      'revoke all on function public.update_minute_metadata_with_wiki_retraction',
    )
    const create = functionSql(
      'create_minute_with_version',
      'revoke all on function public.create_minute_with_version',
    )

    expect(metadata).toContain('v_chronology_changed')
    expect(metadata).toMatch(
      /v_original_minute\.minute_date is distinct from v_minute\.minute_date[\s\S]*v_original_minute\.meeting_occurrence_date[\s\S]*is distinct from v_minute\.meeting_occurrence_date/,
    )
    expect(metadata).toMatch(
      /old_project_id is distinct from new_project_id or v_chronology_changed[\s\S]*from public\.retract_minute_wiki_sources\(/,
    )
    expect(metadata).toContain('wiki_rebuild_required boolean')
    expect(metadata).toContain(
      'old_project_id is distinct from new_project_id or v_chronology_changed',
    )
    expect(metadata).toMatch(
      /select old_project_id as project_id[\s\S]*union[\s\S]*select new_project_id as project_id[\s\S]*order by scope\.project_id/,
    )
    expect(metadata).toMatch(
      /where rebuild\.project_id = v_lock_project_id\s+for update;/,
    )
    expect(create).toContain('wiki_rebuild_required boolean')
    expect(create).toContain("'wiki-project-chronology:' || v_project_id::text")
    expect(create).toMatch(
      /wiki_rebuild_required := v_project_id is not null/,
    )
    expect(create).toMatch(
      /if v_reset_required then[\s\S]*request_wiki_project_rebuild\([\s\S]*else[\s\S]*request_wiki_project_append\(/,
    )
  })

  it('프로젝트 rebuild는 500건 cap 대신 durable 1-row orchestration과 복합 keyset을 사용한다', () => {
    const appendRequest = functionSql(
      'request_wiki_project_append',
      'revoke all on function public.request_wiki_project_append',
    )

    expect(wikiIngestSource).not.toContain('.limit(500)')
    expect(wikiIngestSource).toContain('processWikiProjectRebuildStep')
    expect(wikiIngestSource).toContain(".rpc('claim_wiki_project_rebuild_step'")
    expect(wikiIngestSource).toContain(".rpc('finish_wiki_project_rebuild_step'")

    expect(migration).toContain('create table if not exists public.wiki_project_rebuild_jobs')
    expect(migration).toContain('reset_generation          bigint')
    expect(migration).toContain('create or replace function public.request_wiki_project_rebuild')
    expect(migration).toContain('create or replace function public.request_wiki_project_append')
    expect(migration).toMatch(
      /request_wiki_project_append[\s\S]*reset_generation, rerun_requested[\s\S]*p_project_id, 'pending', 1, 1, false/,
    )
    const appendConflict = appendRequest.slice(appendRequest.indexOf('on conflict (project_id)'))
    expect(appendConflict).not.toMatch(/\bgeneration\s*=/)
    expect(appendConflict).not.toMatch(/\breset_generation\s*=/)
    expect(appendConflict).not.toMatch(/\bcursor_observed_sort\s*=/)
    expect(appendConflict).not.toMatch(/\bstep_wiki_job_id\s*=/)
    expect(appendRequest).toMatch(
      /update public\.wiki_processing_jobs job[\s\S]*attempts = 0[\s\S]*append_job\.step_wiki_job_id[\s\S]*job\.status = 'dead_letter'/,
    )
    expect(migration).toMatch(
      /insert into public\.wiki_project_rebuild_jobs[\s\S]*from public\.minutes minute[\s\S]*on conflict \(project_id\) do nothing/,
    )
    expect(migration).toContain('cursor_observed_sort')
    expect(migration).toContain('cursor_minute_id')
    expect(migration).toContain('generation = rebuild.generation + 1')

    expect(atomicMigration).toContain(
      'create or replace function public.claim_wiki_project_rebuild_step',
    )
    expect(atomicMigration).toContain(
      'create or replace function public.finish_wiki_project_rebuild_step',
    )
    expect(atomicMigration).toMatch(
      /\(candidate\.observed_sort, candidate\.minute_id\)\s*>\s*\(v_rebuild\.cursor_observed_sort, v_rebuild\.cursor_minute_id\)/,
    )
    expect(atomicMigration).toMatch(
      /order by candidate\.observed_sort, candidate\.minute_id\s+limit 1/,
    )
    expect(atomicMigration).toMatch(
      /coalesce\(minute\.meeting_occurrence_date, minute\.minute_date\)::timestamp\s*\+\s*\(minute\.created_at at time zone 'UTC'\)::time/,
    )
    expect(atomicMigration).not.toMatch(
      /coalesce\(minute\.meeting_occurrence_date, minute\.minute_date\)::timestamp\s*\+\s*\(version\.created_at at time zone 'UTC'\)::time/,
    )
    expect(atomicMigration).toContain(
      'cursor_observed_sort = v_rebuild.step_observed_sort',
    )
    expect(atomicMigration).toContain(
      'cursor_minute_id = v_rebuild.step_minute_id',
    )
  })
})
