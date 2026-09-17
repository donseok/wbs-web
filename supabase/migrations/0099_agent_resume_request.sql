-- supabase/migrations/0099_agent_resume_request.sql
-- 멈춘 좌석의 「이어서 시작」 요청 — 화면(좌석표)이 남기고 팀장(/dflow-team)이 watch 응답으로 가져간다.
-- 상태 전이가 아니다: 주문은 claimed 그대로 두고 표식만 얹는다. release 처럼 claimed_by 를 지우면
-- 그 워크트리를 가진 PC 를 특정할 수 없어 재개 자체가 불가능해진다.
-- 단일 슬롯이라 같은 버튼을 두 번 눌러도 같은 행을 덮어쓴다(리포트 행으로 쌓지 않는 이유).
alter table public.agent_work_orders
  add column if not exists resume_requested_at   timestamptz,
  add column if not exists resume_requested_by   uuid references auth.users(id) on delete set null,
  add column if not exists resume_requested_host text;

comment on column public.agent_work_orders.resume_requested_at is
  '사람이 좌석표에서 「이어서 시작」을 누른 시각. 워커가 다시 heartbeat 를 보내면 서버가 비운다.';
comment on column public.agent_work_orders.resume_requested_host is
  '이어받을 PC — claimed_by(claude-<host>)에서 파생한 슬러그이며 agent_watchers.host 와 같은 축이다. 클라이언트가 보내지 않는다.';

-- watch 가 "내 신원의 재개 요청"만 훑는 경로. 요청이 걸린 행은 늘 소수라 부분 인덱스로 족하다.
create index if not exists agent_work_orders_resume_idx
  on public.agent_work_orders (claimed_by_user_id, resume_requested_at)
  where resume_requested_at is not null;
