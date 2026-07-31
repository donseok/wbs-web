-- 프로젝트 설정 계층 (스펙 §7 — 행 없음 = 전체 기본값이 계약)
begin;
set search_path = public, extensions;

create table if not exists public.project_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  level_labels    text[]  not null default array['Phase','Task','Activity'],
  max_depth       int,
  extra_axis_label text,
  milestone_keywords text[] not null default array[]::text[],
  excel_profile   jsonb   not null default '{}'::jsonb,
  -- P3/P4/P7 자리 — 이번 스펙에서는 읽지 않는다(스펙 §7.2)
  enabled_modules text[],
  weekly_sections text[],
  working_days    int[],
  timezone        text,
  preset_applied  text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

alter table public.project_settings enable row level security;
drop policy if exists read_project_settings on public.project_settings;
create policy read_project_settings on public.project_settings for select to authenticated
  using (true);  -- 설정은 로그인 사용자 전원 조회(라벨·키워드는 화면 공용). 쓰기 정책 없음(서버 관문).

revoke all on table public.project_settings from public, anon, authenticated;
grant select on table public.project_settings to authenticated;
grant all on table public.project_settings to service_role;

-- §7.5 — 기존 프로젝트 전부에 '현행 동작 재현' 행을 시드한다. 이 행이 있으면 화면은 1픽셀도 안 바뀐다.
insert into public.project_settings (project_id, level_labels, max_depth, extra_axis_label, milestone_keywords, weekly_sections, preset_applied)
select p.id,
       array['Phase','Task','Activity'],
       3,
       'Biz',
       array['착수보고','중간보고','보고회','마스터 플랜','bmt','최종 선정','승인','준공','kick-off','킥오프'],
       array['PMO','영업','구매','관리회계','품질','생산계획','조업및표준화','물류','설비및L2','가공'],
       'legacy-dcube'
from public.projects p
on conflict (project_id) do nothing;

reset search_path;
commit;
