-- 0019 롤백. email 소문자 정규화는 되돌리지 않는다(원본 대소문자는 복원 불가하며 무해).
-- 주의: 코드(src/lib/data/meetings.ts resolveMemberIds)가 user_id 를 조회하므로,
-- 롤백 전에 반드시 코드를 0019 이전 리비전으로 되돌릴 것.

drop trigger if exists on_auth_user_created_link_members on auth.users;
drop function if exists auth_user_link_project_members();

drop trigger if exists project_members_normalize_link_trg on project_members;
drop function if exists project_members_normalize_link();

drop index if exists project_members_user_idx;
drop index if exists project_members_email_idx;
drop index if exists project_members_project_user_uidx;
drop index if exists project_members_project_email_uidx;

-- 0013 이 만들었던 인덱스 복원(ILIKE 로는 못 쓰지만 원상복구를 위해).
create index if not exists project_members_email_lower_idx on project_members (lower(email));

alter table project_members drop column if exists user_id;
