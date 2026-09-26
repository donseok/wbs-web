-- storage.objects RLS 정책 정본 (전 환경 공통)
--
-- 왜 마이그레이션이 아니라 별도 파일인가: 이 9건은 운영에 이미 존재한다(각 기능의 옛
-- 마이그레이션이 만들었다). 번호 마이그레이션으로 만들면 운영에 drop+create 가 다시 돌아
-- 이득 없이 위험만 생긴다. 이 파일은 **의도된 상태의 정본**이며, 정책이 유실된 환경을
-- 복구하는 데 쓴다. 정의는 2026-09-27 운영(rglfgrwwwwdqejohdnty) pg_policies 실측에서
-- 그대로 생성했다(손으로 옮겨 적지 않았다).
--
-- 언제 필요한가 — `staging:sync` 는 `drop schema if exists public cascade` 로 public 을
-- 재생성한다. 9건 중 7건이 public 의 can_attach·can_edit_issue·app_role·minute_versions 를
-- 참조하므로 그 cascade 에 함께 삭제된다. 그래서 sync 마지막에 이 파일을 재적용한다.
--
-- 없으면 무슨 일이 나는가 — storage.objects 는 RLS 가 켜져 있으므로 정책이 0건이면 전면
-- 거부다. 2026-09-27 스테이징이 정확히 그 상태였고, 회의록 본문 .md·회의록 첨부·이슈 첨부·
-- WBS 산출물의 모든 업로드가 `new row violates row-level security policy for table "objects"`
-- 로 실패했다(스테이징 minutes 버킷 객체 0건 / 운영 26건).
--
-- 적용: npm run db:apply -- supabase/storage-policies.sql --target staging
-- 멱등: drop policy if exists 선행 — 반복 실행 안전.
-- 검증: 운영과 정의가 일치하는지 pg_policies 로 대조할 것(9건, 양방향 차이 0).

drop policy if exists "deliverables delete" on storage.objects;
create policy "deliverables delete" on storage.objects
  as permissive
  for delete
  to authenticated
  using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));

drop policy if exists "deliverables insert" on storage.objects;
create policy "deliverables insert" on storage.objects
  as permissive
  for insert
  to authenticated
  with check (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));

drop policy if exists "deliverables read" on storage.objects;
create policy "deliverables read" on storage.objects
  as permissive
  for select
  to authenticated
  using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));

drop policy if exists "issue-attachments delete" on storage.objects;
create policy "issue-attachments delete" on storage.objects
  as permissive
  for delete
  to authenticated
  using (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));

drop policy if exists "issue-attachments insert" on storage.objects;
create policy "issue-attachments insert" on storage.objects
  as permissive
  for insert
  to authenticated
  with check (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));

drop policy if exists "issue-attachments read" on storage.objects;
create policy "issue-attachments read" on storage.objects
  as permissive
  for select
  to authenticated
  using ((bucket_id = 'issue-attachments'::text));

drop policy if exists "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects
  as permissive
  for delete
  to authenticated
  using (((bucket_id = 'minutes'::text) AND ((owner = auth.uid()) OR (app_role() = 'pmo_admin'::text)) AND (NOT (EXISTS ( SELECT 1
   FROM minute_versions mv
  WHERE (mv.file_path = objects.name))))));

drop policy if exists "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects
  as permissive
  for insert
  to authenticated
  with check ((bucket_id = 'minutes'::text));

drop policy if exists "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects
  as permissive
  for select
  to authenticated
  using ((bucket_id = 'minutes'::text));
