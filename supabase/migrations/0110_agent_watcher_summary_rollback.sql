-- supabase/migrations/0110_agent_watcher_summary_rollback.sql
begin;
alter table public.agent_watchers drop constraint if exists agent_watchers_input_request_shape;
alter table public.agent_watchers drop constraint if exists agent_watchers_lead_summary_shape;
alter table public.agent_watchers drop constraint if exists agent_watchers_summary_shape;
alter table public.agent_watchers drop column if exists input_request;
alter table public.agent_watchers drop column if exists lead_summary;
alter table public.agent_watchers drop column if exists summary;
commit;
-- 주의: 이 롤백은 코드(main)를 되돌린 뒤에 돌린다. 코드가 먼저 남아 있는 채 칸을 지우면
-- 좌석표 조회(select 에 summary·lead_summary·input_request 포함)와 watch upsert 가 모두 실패한다.
