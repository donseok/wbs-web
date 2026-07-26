-- 0045 롤백 — 회의록 기반 Living Wiki 스키마를 제거한다.
--
-- 경고(데이터 소실)
--   · 모든 Wiki 주제/지식/근거/관계/변경 이력/처리 작업이 삭제된다.
--   · minute_versions 의 과거 본문과 파일 메타가 삭제된다.
--   · minutes 의 project_id/meeting_occurrence_date/archived_at 값도 삭제된다.
-- 원본 minutes.body_md 및 minute_files 실물/메타는 건드리지 않는다.
-- 가능하면 Wiki 코드를 먼저 롤백한 뒤 적용하고, 필요한 지식/버전은 drop 전에 백업할 것.
-- 멱등: 테이블/함수/인덱스/컬럼이 이미 없어도 반복 실행 안전하다.

set search_path = public, extensions;

-- minute_versions 참조 정책을 먼저 제거해야 테이블 drop 의존성이 풀린다.
drop policy if exists "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes' and (owner = auth.uid() or app_role() = 'pmo_admin'));

-- 0045 service-only RPC/trigger를 테이블보다 먼저 제거한다(rowtype 의존성).
do $$
begin
  if to_regclass('public.ai_documents') is not null then
    execute 'drop trigger if exists ai_documents_minute_scope_guard_trg on public.ai_documents';
  end if;
  if to_regclass('public.wiki_change_events') is not null then
    execute 'drop trigger if exists wiki_change_events_source_provenance_trg on public.wiki_change_events';
  end if;
  if to_regclass('public.minute_versions') is not null then
    execute 'drop trigger if exists minute_versions_immutable_trg on public.minute_versions';
  end if;
end $$;

drop function if exists public.archive_minute_with_wiki_retraction(uuid, text);
drop function if exists public.finish_wiki_project_rebuild_step(
  uuid, text, text, timestamptz
);
drop function if exists public.claim_wiki_project_rebuild_step(uuid, text, integer);
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text, jsonb
);
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text
);
drop function if exists public.create_minute_with_version(
  uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text,
  text, text, bigint, text
);
drop function if exists public.update_minute_metadata_with_wiki_retraction(uuid, jsonb);
drop function if exists public.retract_minute_wiki_sources(uuid, text);
drop function if exists public.request_wiki_project_rebuild(uuid, text);
drop function if exists public.request_wiki_project_append(uuid, text);
drop function if exists public.queue_minute_ai_index_scope_change(
  uuid, uuid, text, timestamptz
);
drop function if exists public.guard_minute_ai_document_scope();
drop function if exists public.wiki_change_events_copy_source_provenance();
drop function if exists public.minute_versions_reject_mutation();

-- FK 의존 자식부터 제거한다. 정책·테이블 identity sequence 는 테이블과 함께 제거된다.
drop table if exists public.wiki_project_rebuild_jobs;
drop table if exists public.wiki_processing_jobs;
drop table if exists public.wiki_change_events;
drop table if exists public.wiki_item_relations;
drop table if exists public.wiki_item_sources;
drop table if exists public.wiki_items;
drop table if exists public.wiki_topics;
drop table if exists public.minute_versions;

drop function if exists public.wiki_fnv1a64(text);

-- 0021의 직접 쓰기 정책/권한으로 복원한다. read 정책은 0045가 제거하지 않았으므로 유지된다.
drop policy if exists attachment_insert_minute_files on public.minute_files;
drop policy if exists attachment_update_minute_files on public.minute_files;
drop policy if exists attachment_delete_minute_files on public.minute_files;
drop policy if exists own_write_minute_files on public.minute_files;
create policy own_write_minute_files on public.minute_files
  for all to authenticated
  using (
    exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  )
  with check (
    exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  );
revoke all on table public.minute_files from public, anon, authenticated;
grant select, insert, update, delete on table public.minute_files to authenticated;
grant all on table public.minute_files to service_role;

drop policy if exists insert_own_minutes on public.minutes;
create policy insert_own_minutes on public.minutes
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);
drop policy if exists update_own_minutes on public.minutes;
create policy update_own_minutes on public.minutes
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');
drop policy if exists delete_own_minutes on public.minutes;
create policy delete_own_minutes on public.minutes
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
revoke all on table public.minutes from public, anon, authenticated;
grant select, insert, update, delete on table public.minutes to authenticated;
grant all on table public.minutes to service_role;

drop index if exists public.minutes_project_occurrence_idx;
drop index if exists public.minutes_project_archived_idx;

alter table public.minutes drop constraint if exists minutes_project_fk;
alter table public.minutes drop column if exists archived_at;
alter table public.minutes drop column if exists meeting_occurrence_date;
alter table public.minutes drop column if exists project_id;

reset search_path;
