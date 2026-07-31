-- 레벨 모델 해방 (스펙 §4.2·§5.2). alter 는 제약 해제와 컬럼 추가뿐 — 데이터 변형은 백필 update 1건.
begin;
set search_path = public, extensions;

alter table public.wbs_items drop constraint if exists wbs_items_level_check;
alter table public.wbs_items alter column level drop not null;
comment on column public.wbs_items.level is
  'DEPRECATED — 깊이의 진실은 parent_id 트리다. 하위호환 표시용으로만 남긴다. 신규 코드는 읽지 않는다.';

alter table public.wbs_items add column if not exists is_owner_split boolean not null default false;

-- 백필: 부모가 activity 인 activity = 기존 sub-act (§5.2). 적용 전후 건수 대조는 적용 절차(Task 11)에서.
update public.wbs_items c set is_owner_split = true
from public.wbs_items p
where c.parent_id = p.id and c.level = 'activity' and p.level = 'activity'
  and c.is_owner_split = false;

reset search_path;
commit;
