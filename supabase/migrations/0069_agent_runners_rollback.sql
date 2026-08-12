-- 0069 rollback: agent_runners 제거. PAT 발급분은 전부 소멸한다(재발급으로 복구).
begin;
drop table if exists public.agent_runners;
commit;
