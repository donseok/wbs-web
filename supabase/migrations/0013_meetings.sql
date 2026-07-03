-- 회의 (프로젝트 스코프) + 참석자 + 반복 예외
-- 권한: 읽기 = 인증 사용자 전체(게스트 포함) / 쓰기 = 생성은 멤버십 보유자 본인,
--       수정·삭제는 작성자(created_by) 또는 pmo_admin. 앱 최초의 사용자 생성 콘텐츠.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0012와 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/ db push 는 사용하지 않는다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().
--       새 헬퍼 함수를 만들지 않고 (created_by = auth.uid() or app_role() = 'pmo_admin') 식을 인라인 반복.

create or replace function public.app_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  meeting_date date not null,
  start_time text,
  end_time text,
  location text,
  category text not null default 'general'
    check (category in ('general','routine','kickoff','review','report','external')),
  body text not null default '',
  recurrence text not null default 'none'
    check (recurrence in ('none','daily','weekly','biweekly','monthly')),
  recurrence_until date,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_start_time_fmt check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_end_time_fmt   check (end_time  is null or end_time  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint meetings_time_order     check (end_time is null or (start_time is not null and end_time > start_time)),
  constraint meetings_recur_until    check (recurrence_until is null or recurrence_until >= meeting_date),
  constraint meetings_recur_none     check (recurrence <> 'none' or recurrence_until is null)
);
create index if not exists meetings_project_idx on meetings(project_id, meeting_date);

create table if not exists meeting_attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  member_id  uuid not null references project_members(id) on delete cascade,
  primary key (meeting_id, member_id)
);

create table if not exists meeting_exceptions (
  meeting_id uuid not null references meetings(id) on delete cascade,
  occurrence_date date not null,
  kind text not null default 'cancelled' check (kind in ('cancelled')),
  primary key (meeting_id, occurrence_date)
);

-- email 이 표시 필드에서 '내 회의' 본인 식별 조인 키로 승격 → lower(email) 함수형 인덱스.
create index if not exists project_members_email_lower_idx on project_members (lower(email));

alter table meetings           enable row level security;
alter table meeting_attendees  enable row level security;
alter table meeting_exceptions enable row level security;

-- meetings: 읽기 전체 / 생성 본인(멤버) / 수정·삭제 작성자 또는 pmo
drop policy if exists read_all_meetings on meetings;
create policy read_all_meetings on meetings for select to authenticated using (true);

drop policy if exists insert_own_meetings on meetings;
create policy insert_own_meetings on meetings
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_meetings on meetings;
create policy update_own_meetings on meetings
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_meetings on meetings;
create policy delete_own_meetings on meetings
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

-- 자식 테이블: 읽기 전체 / 쓰기는 부모 회의 소유권 미러(EXISTS)
drop policy if exists read_all_meeting_attendees on meeting_attendees;
create policy read_all_meeting_attendees on meeting_attendees for select to authenticated using (true);

drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees
  for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')));

drop policy if exists read_all_meeting_exceptions on meeting_exceptions;
create policy read_all_meeting_exceptions on meeting_exceptions for select to authenticated using (true);

drop policy if exists own_write_meeting_exceptions on meeting_exceptions;
create policy own_write_meeting_exceptions on meeting_exceptions
  for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or app_role() = 'pmo_admin')));
