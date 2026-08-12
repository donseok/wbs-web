-- 0072: agent_work_orders.claimed_by_user_id — 점유 소유권을 자유 문자열 라벨(claimed_by)에서
-- 사용자 귀속으로 이관(계약 v2.0 §2.3). PAT 경로에서만 기록·판정하며 레거시 경로는 라벨 그대로.
-- v1 원칙 "기존 테이블 ALTER 0건"과 충돌해 보이나 대상은 v1 이 만든 에이전트 전용 테이블이고
-- D-CUBE 핵심 테이블은 무변경 — nullable 추가라 기존 행·레거시 경로 무영향.
-- on delete set null: 사용자 소멸 후에도 주문은 감사 기록으로 남긴다(wbs_item_id 와 같은 정책).
begin;
alter table public.agent_work_orders
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null;
create index if not exists agent_work_orders_claim_owner_idx
  on public.agent_work_orders (claimed_by_user_id, status)
  where claimed_by_user_id is not null;
commit;
