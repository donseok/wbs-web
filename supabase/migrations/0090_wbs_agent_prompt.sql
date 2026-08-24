-- 0090: wbs_items.agent_prompt — 에이전트에 넘길 사용자 지시문(프롬프트)
--
-- 위임 모델(2026-08-24 확정): 사람 신호는 위임 체크(tags:agent) 하나이고, 프롬프트는 그 신호에
-- 덧붙이는 자유 지시문이다. spec 에 끼우지 않는 이유 — spec 정본은 import(0077 import_wbs_upsert)라
-- 재업로드가 덮어써 사용자 입력이 증발한다. agent_prompt 는 웹 전용 필드로 import RPC 가 건드리지
-- 않아 재업로드에도 보존된다. 소비처: PAT 상세 API(ITEM_DETAIL_COLUMNS) → /dflow-dev 지시 반영.
alter table public.wbs_items
  add column if not exists agent_prompt text;

comment on column public.wbs_items.agent_prompt is
  '에이전트 위임 시 사용자 지시문 — 웹 편집 전용(import 무접촉), 소비는 PAT 상세 API';
