-- 0102: agent_work_reports.decisions — 워커가 스스로 고른 결정 목록(과제 C,
-- docs/superpowers/specs/2026-09-23-worker-decision-report-design.md §3).
-- null = 제출 안 됨(구 CLI·구 서버·수동 보고), [] = 0건 명시. default 를 두지 않는다 — 두면 "0건" 과 "모름" 이 같아진다.
-- 항목 모양 검증은 앱(validateDecisions, src/lib/domain/agentWork.ts)이 한다(0073 evidence 와 같은 분담).
-- CHECK 는 CASE 로 쓴다: Postgres 는 AND 의 평가 순서를 보장하지 않아, 배열이 아닌 값에서 jsonb_array_length 가
-- 먼저 돌면 23514 대신 22023 으로 거부된다(스펙 §3.2 식에서 바꾼 점).
-- 권한: 0057 의 read_agent_work_reports 정책과 table-level grant select 가 새 컬럼을 그대로 덮는다. 쓰기는 service_role 뿐.
begin;
alter table public.agent_work_reports
  add column if not exists decisions jsonb;
alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports
  add constraint agent_work_reports_decisions_shape check (
    decisions is null
    or case when jsonb_typeof(decisions) = 'array'
         then jsonb_array_length(decisions) <= 20 and kind = 'completion'
         else false end
  );
-- 좌석표(주문 최대 2000건)·결재 배지는 수만 필요하다 — jsonb 본문을 끌어오지 않게 한다.
-- decisions 가 null 이면 decision_count 도 null 이라 "모름" 을 그대로 잇는다.
alter table public.agent_work_reports
  add column if not exists decision_count int
  generated always as (case when jsonb_typeof(decisions) = 'array' then jsonb_array_length(decisions) end) stored;
commit;
