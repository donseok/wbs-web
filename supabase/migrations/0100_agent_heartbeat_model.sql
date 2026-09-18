-- supabase/migrations/0100_agent_heartbeat_model.sql
-- 에이전트 보기 명찰(2026-09-18) — 팀원이 지금 돌리는 Phase 서브에이전트의 모델.
-- dflow-dev 는 Phase 마다 다른 모델의 서브에이전트를 띄운다(dev-discipline 모델 배정표: 설계 opus/sonnet,
-- 검증 haiku …). 오케스트레이터가 Phase 시작 때 state.json 에 모델을 적고, PostToolUse 훅이 heartbeat 에 싣는다.
-- 이력은 남기지 않는다(0094 와 같은 이유) — 마지막 값만 덮어쓴다. heartbeat 가 model 을 생략하면 그대로 둔다.
-- 재위임으로 heartbeat 열을 비우는 함수(0097)는 이 열을 모른다: 화면은 last_heartbeat_at 이 null 이면 이 값을 쓰지 않는다.
alter table public.agent_work_orders
  add column if not exists heartbeat_model text;

comment on column public.agent_work_orders.heartbeat_model is
  '마지막 heartbeat 가 말한 실행 모델(예: claude-opus-4-8, haiku). 화면 명찰·등급의 정본. last_heartbeat_at 이 null 이면 무효.';
