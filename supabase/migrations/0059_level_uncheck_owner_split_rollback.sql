-- 롤백 — 위반 행이 있으면 중단하고 리포트 (§4.2 — 조용히 데이터를 고치지 않는다).
begin;
set search_path = public, extensions;
do $$
declare bad int;
begin
  select count(*) into bad from public.wbs_items
   where level is null or level not in ('phase','task','activity');
  if bad > 0 then
    raise exception '0059 롤백 중단: level 3값 밖 행 %건 — 먼저 데이터를 정리하라 (select distinct level from wbs_items)', bad;
  end if;
end $$;
alter table public.wbs_items alter column level set not null;
alter table public.wbs_items add constraint wbs_items_level_check
  check (level in ('phase','task','activity'));
alter table public.wbs_items drop column if exists is_owner_split;
reset search_path;
commit;
