-- 회의록 외부 업로드 멱등키 (또박또박 연동 — docs/design/dflow-minutes-upload-api-spec.md §9.1)
-- external_id: 외부 시스템이 부여하는 불투명 문자열(예: 'ddobak:<uuidv7>'). UI 업로드 건은 null 유지.
-- 부분 유니크 인덱스는 share_token(0026_minute_share.sql) 관례와 동일.
-- 주의: 프로덕션 적용은 Management API 경로(레포 기록용).

alter table minutes add column if not exists external_id text;

create unique index if not exists minutes_external_id_uidx
  on minutes (external_id) where external_id is not null;

-- 멱등키 불변식의 DB 강제: update_own_minutes 정책은 소유 행의 전 컬럼 update 를 허용하므로,
-- 로그인 사용자가 브라우저에서 PostgREST 로 external_id 를 직접 세팅/변조하면
-- ① 미전송 회의의 'ddobak:<uuid>' 선점(정식 전송이 남의 레코드를 replace)
-- ② API 생성 건의 키 해제(재전송이 중복 신규 생성) 가 가능해진다.
-- JWT role 이 authenticated/anon 인 요청만 차단 — service_role(연동 API)과
-- 직접 SQL(Management API 수동 운영, 예: §4b 연결 해제)은 그대로 허용한다.
create or replace function public.minutes_protect_external_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
begin
  if jwt_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.external_id is not null then
      raise exception 'external_id는 외부 연동 API로만 설정할 수 있습니다.';
    end if;
    if tg_op = 'UPDATE' and new.external_id is distinct from old.external_id then
      raise exception 'external_id는 외부 연동 API로만 변경할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists minutes_protect_external_id_trg on minutes;
create trigger minutes_protect_external_id_trg
before insert or update on minutes
for each row execute function public.minutes_protect_external_id();
