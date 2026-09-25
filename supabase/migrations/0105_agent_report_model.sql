-- supabase/migrations/0105_agent_report_model.sql
-- 보고별 실행 모델(2026-09-25) — WBS 상세 "진행 상황" 표의 에이전트 칸을 단계별 사용 모델로 바꾼다.
-- 0100 의 heartbeat_model 은 주문에 마지막 값 하나만 남아 단계마다 어떤 모델이 일했는지 사라진다.
-- report 라우트가 보고를 넣는 순간의 heartbeat_model 을 이 열에 복사한다(dflow-dev 는 Phase 서브에이전트를
-- 띄우기 직전에 모델을 쓰고, 끝난 뒤 progress 를 보고하므로 그 시점 값이 끝난 단계의 모델이다).
-- null = 모름(이 열 이전의 보고, heartbeat 가 없던 주문). 권한: 0057 read 정책·grant select 가 새 열을 덮는다.
alter table public.agent_work_reports
  add column if not exists model text;

comment on column public.agent_work_reports.model is
  '보고 시점 주문의 heartbeat_model(0100) 복사본 — 그 단계를 돌린 모델. null 이면 모름.';
