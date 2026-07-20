-- 프로덕션 역이식(back-port) — 2026-07-20 드리프트 정리.
-- 아래 객체들은 프로덕션(ref rglfgrwwwwdqejohdnty)에는 이미 존재하지만 레포 마이그레이션에
-- 없던 것들이다(pg_get_functiondef / pg_policies 원문 대조로 역이식). 멱등 스크립트라
-- 프로덕션에 재적용해도 동일 상태로 수렴하고, 신규 환경에서는 0008 이 만든 느슨한
-- 첨부 정책을 실제 운영 수준으로 조인다.
-- 롤백 파일 없음(의도): 롤백하면 첨부 쓰기가 무제한 개방으로 되돌아가 보안 후퇴가 된다.

-- 1) 첨부 권한 헬퍼 — PMO admin 이거나 해당 WBS 항목의 담당 팀이면 첨부 가능.
--    app_role()/current_team() 은 0002 정의(프로덕션 기배포)와 동일 정의를 전제.
create or replace function public.can_attach(item uuid) returns boolean
language sql stable as $$
  select app_role() = 'pmo_admin'
      or exists (
        select 1 from item_owners o
        where o.wbs_item_id = item and o.team_id = current_team()
      )
$$;

-- 2) deliverables 스토리지 정책 — 버킷 전체 개방(0008) → 객체 경로 첫 세그먼트가
--    wbs_item_id 라는 규약을 이용해 can_attach 로 축소.
drop policy if exists "deliverables read" on storage.objects;
drop policy if exists "deliverables insert" on storage.objects;
drop policy if exists "deliverables delete" on storage.objects;
create policy "deliverables read" on storage.objects for select to authenticated
  using (bucket_id = 'deliverables' and can_attach(split_part(name, '/', 1)::uuid));
create policy "deliverables insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'deliverables' and can_attach(split_part(name, '/', 1)::uuid));
create policy "deliverables delete" on storage.objects for delete to authenticated
  using (bucket_id = 'deliverables' and can_attach(split_part(name, '/', 1)::uuid));

-- 3) 첨부 메타 정책 — 무제한 쓰기(0008 write_attachments) → can_attach 기준
--    insert/delete 로 축소(update 정책은 프로덕션에도 없음 — 첨부는 교체=삭제+재업로드).
drop policy if exists write_attachments on deliverable_attachments;
drop policy if exists attach_insert on deliverable_attachments;
drop policy if exists attach_delete on deliverable_attachments;
create policy attach_insert on deliverable_attachments for insert to authenticated
  with check (can_attach(wbs_item_id));
create policy attach_delete on deliverable_attachments for delete to authenticated
  using (can_attach(wbs_item_id));

-- 4) 멤버십 관리 — PMO admin 전체 쓰기(이 정책이 없으면 멤버십 관리 UI가 동작 불가).
drop policy if exists pmo_write_memberships on memberships;
create policy pmo_write_memberships on memberships for all to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');
