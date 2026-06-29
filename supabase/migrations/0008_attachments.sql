-- 산출물 파일 첨부 — wbs_items의 deliverable(텍스트)에 실제 증빙 파일을 연결.
-- 파일은 Supabase Storage의 'deliverables' 버킷(비공개)에, 메타데이터는 아래 테이블에.

insert into storage.buckets (id, name, public)
values ('deliverables', 'deliverables', false)
on conflict (id) do nothing;

-- 버킷 객체 접근: 로그인 사용자면 읽기/쓰기/삭제 가능(세부 권한은 서버 액션에서 담당팀/PMO로 강제).
create policy "deliverables read" on storage.objects for select to authenticated
  using (bucket_id = 'deliverables');
create policy "deliverables insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'deliverables');
create policy "deliverables delete" on storage.objects for delete to authenticated
  using (bucket_id = 'deliverables');

create table if not exists deliverable_attachments (
  id uuid primary key default gen_random_uuid(),
  wbs_item_id uuid not null references wbs_items(id) on delete cascade,
  file_name text not null,
  file_path text not null,            -- storage object 경로
  size bigint,
  mime text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists deliverable_attachments_item_idx on deliverable_attachments(wbs_item_id);

alter table deliverable_attachments enable row level security;
create policy read_all_attachments on deliverable_attachments for select to authenticated using (true);
-- insert/delete는 RLS는 넓게, 실제 담당팀/PMO 강제는 서버 액션(recordAttachment/removeAttachment)에서.
create policy write_attachments on deliverable_attachments for all to authenticated
  using (true) with check (true);
