-- 0050_migration_ledger.sql 롤백.
--
-- 경고: 이 표에 쌓인 적용 이력이 전부 소실된다. 원장은 다른 곳에 사본이 없다.
-- 되돌리기 전에 최소한 다음을 떠서 보관할 것:
--   select * from public.migration_ledger order by applied_at;
--
-- 이 표는 앱 런타임이 읽지 않으므로 삭제해도 서비스에 영향은 없다.

set search_path = public, extensions;

drop index if exists public.migration_ledger_applied_at_idx;
drop table if exists public.migration_ledger;

reset search_path;
