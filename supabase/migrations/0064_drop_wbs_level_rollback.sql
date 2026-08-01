-- 0064 롤백 — level 컬럼을 nullable 로 되살린다.
--
-- ⚠️ 데이터는 복원되지 않는다: drop 으로 각 행의 옛 level 문자열 값은 소실됐다. 컬럼만 재생성한다.
-- 필요하면 값은 트리로 재파생 가능하다(depth 0→'phase', 1→'task', 그 외→'activity'; sub-act 는 is_owner_split
-- 로 식별) — 그러나 그 백필은 이 롤백의 책임이 아니다. 애초에 0064 를 적용하려면 어떤 코드도 level 을
-- 읽지 않는 상태였어야 하므로, 컬럼을 되살리는 것만으로 스키마 형태는 원복된다.
begin;
set search_path = public, extensions;

alter table public.wbs_items add column if not exists level text;

reset search_path;
commit;
