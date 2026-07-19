-- 0034 롤백 — external_id 컬럼/인덱스 제거.
-- 주의: 또박또박 연결 정보가 소실되어 이후 재전송이 기존 레코드를 못 찾고 새 레코드를 만든다(중복).

drop trigger if exists minutes_protect_external_id_trg on minutes;
drop function if exists public.minutes_protect_external_id();
drop index if exists minutes_external_id_uidx;
alter table minutes drop column if exists external_id;
