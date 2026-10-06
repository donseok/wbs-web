-- supabase/migrations/0110_agent_watcher_summary.sql
-- 감시자 행에 조정자 킷이 싣는 표시 전용 jsonb 세 칸을 더한다. 계약: lanes/lane-summary-contract.md (v:1).
--   summary       레인 요약 — 임시 팀원(임시:<레인>·<요약>) watch 에 싣는다.
--   lead_summary  팀장 자리 요약 — 조정 팀장(coord:<세션8>) watch 에 싣는다.
--   input_request 입력 요청 발췌 — 레인 watch 에 싣고, 창이 사라지면 null 로 지운다.
-- 앱(watch 라우트)이 허용한 키만 다시 지어 저장하고 크기를 자른다 — 여기는 마지막 방어선이다.
-- null 허용: 해당 칸을 보내지 않은 PC 는 null 로 덮어쓴다. 기존 행·정책은 그대로(RLS 정책은 0095 가 이미 정리했다).
-- 코드보다 먼저 적용한다 — 칸이 없는 채로 코드가 배포되면 watch upsert 와 좌석표 조회가 실패한다.
begin;

alter table public.agent_watchers
  add column if not exists summary jsonb,
  add column if not exists lead_summary jsonb,
  add column if not exists input_request jsonb;

alter table public.agent_watchers drop constraint if exists agent_watchers_summary_shape;
alter table public.agent_watchers
  add constraint agent_watchers_summary_shape
  check (summary is null or (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096));

alter table public.agent_watchers drop constraint if exists agent_watchers_lead_summary_shape;
alter table public.agent_watchers
  add constraint agent_watchers_lead_summary_shape
  check (lead_summary is null or (jsonb_typeof(lead_summary) = 'object' and octet_length(lead_summary::text) <= 12288));

alter table public.agent_watchers drop constraint if exists agent_watchers_input_request_shape;
alter table public.agent_watchers
  add constraint agent_watchers_input_request_shape
  check (input_request is null or (jsonb_typeof(input_request) = 'object' and octet_length(input_request::text) <= 4096));

commit;
