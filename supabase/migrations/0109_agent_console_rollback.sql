-- supabase/migrations/0109_agent_console_rollback.sql
begin;
drop function if exists public.agent_console_ack(uuid, uuid, text, text, text, text);
drop function if exists public.agent_console_claim(uuid, text, text[]);
drop function if exists public.agent_console_enqueue(uuid, text, text, text, text);
drop function if exists public.agent_console_sweep(uuid);
drop table if exists public.agent_console_screens;
drop table if exists public.agent_console_prompts;
commit;
