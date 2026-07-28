-- 마이그레이션 적용 원장.
--
-- 왜 필요한가
--   이 프로젝트는 마이그레이션을 Supabase Management API 로 직접 실행한다
--   (`supabase db push` 미사용). 그래서 "무엇이 프로덕션에 실제로 적용됐는지"를
--   기록하는 곳이 DB 에도 리포에도 없었다. 2026-07-27 화면 사고 때 롤백을 검토하면서
--   드러난 공백이다 — 되돌리려는 구간에 어떤 마이그레이션이 걸쳐 있는지 알 수 없으면
--   코드 롤백이 안전한지 판단할 수 없다.
--
-- 핵심 계약
--   1) 이 표는 감사 기록이다. append 와 checksum 정정만 하고 삭제하지 않는다.
--   2) filename 은 리포의 supabase/migrations/ 파일명 그대로다(확장자 포함).
--   3) checksum 은 적용 시점 SQL 본문의 sha256. 리포 파일이 나중에 수정되면
--      불일치로 드러난다 — 이미 적용된 마이그레이션을 손대는 것은 드리프트의 시작이다.
--   4) rollback_available 은 적용 시점에 _rollback.sql 이 함께 있었는지를 남긴다.
--      나중에 파일을 추가해도 "그때 되돌릴 수 있었는가"는 바뀌지 않는다.
--   5) 앱 런타임은 이 표를 읽지 않는다. 운영 도구 전용이라 service_role 만 접근한다.
--
-- 멱등: 반복 실행 안전.
-- 롤백: 0050_migration_ledger_rollback.sql (원장 기록이 전부 소실되므로 경고 확인).

set search_path = public, extensions;

create table if not exists public.migration_ledger (
  filename            text primary key,
  applied_at          timestamptz not null default now(),
  applied_by          text not null,
  checksum            text not null,
  rollback_available  boolean not null default false,
  note                text,

  constraint migration_ledger_filename_check
    check (btrim(filename) <> '' and filename like '%.sql'),
  constraint migration_ledger_applied_by_check
    check (btrim(applied_by) <> ''),
  -- sha256 hex
  constraint migration_ledger_checksum_check
    check (checksum ~ '^[0-9a-f]{64}$')
);

comment on table public.migration_ledger is
  '프로덕션에 적용된 마이그레이션 감사 기록. 롤백 안전성 판단의 근거.';

-- 적용 순서 조회(무엇이 언제 나갔는가)가 유일한 사용 패턴이다.
create index if not exists migration_ledger_applied_at_idx
  on public.migration_ledger (applied_at desc);

alter table public.migration_ledger enable row level security;

-- 운영 도구 전용. authenticated 에는 아무 권한도 주지 않는다.
revoke all on table public.migration_ledger from public, anon, authenticated;
grant all on table public.migration_ledger to service_role;

reset search_path;
