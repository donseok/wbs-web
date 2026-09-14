-- supabase/migrations/0095_agent_watchers_no_select_rollback.sql
drop policy if exists agent_watchers_select on public.agent_watchers;
create policy agent_watchers_select on public.agent_watchers
  for select to authenticated using (true);
