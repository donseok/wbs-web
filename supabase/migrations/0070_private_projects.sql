-- 0070: 비공개 프로젝트 플래그 (설계: docs/superpowers/specs/2026-08-10-private-project-visibility-design.md)
-- 화면 숨김 수준 — RLS 는 건드리지 않는다. 판정은 앱의 canSeeProject 한 곳.
alter table public.projects add column if not exists is_private boolean not null default false;

comment on column public.projects.is_private is
  '비공개 프로젝트 — 역할(admin/member) 보유자와 슈퍼유저에게만 목록·챗봇·회의록 표면에 노출. RLS 잠금 아님(UI 숨김).';
