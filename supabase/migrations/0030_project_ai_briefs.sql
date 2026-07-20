-- AI 브리핑 캐시 — 주간 프로젝트 브리핑(weekly)과 위험 신호 AI 해설(risk)의 단일 캐시 테이블.
--
-- 합성 결정 C1: 두 설계(AI 현황 분석 / 위험 신호 엔진)가 각자 제안한 캐시 테이블을
-- kind 판별자 + cache_key 로 통합한다 — 같은 패턴(LLM 산출물 캐시, service_role 전용 쓰기,
-- 해시 신선도)을 테이블 두 개로 쪼개면 RLS·health 프로빙·드리프트 감사 대상만 늘기 때문.
--   · kind='weekly' : cache_key = base_date ISO(YYYY-MM-DD — getComputedWbs 의 today, 날짜 축 캐시)
--   · kind='risk'   : cache_key = '' (프로젝트당 1행 — 신선도는 input_hash 신호 지문만으로 판정)
--   · input_hash    : 팩트/신호 컨텍스트의 fnv1a64 — 같은 캐시 키라도 입력이 바뀌면 stale
--   · status        : 'ready' = 산출물 있음 / 'none' = 생성 성공·서술할 내용 없음.
--                     행 없음 = 미생성/실패(재시도 대상)와 구분 — 0025 minute_insights 'none' 센티널
--                     관례(재시도 폭주 방지). 기본값 없음: 쓰기는 service_role 코드가 항상 명시.
--   · body_md(weekly 서술 본문)·items(risk 구조화 해설 [{signalId,priority,comment,action}])는
--     kind 별로 한쪽만 사용한다(다른 쪽은 기본값 유지).
--
-- 권한: 읽기 = 인증 사용자 전원 / 쓰기 정책 없음 = service_role 전용(0010/0021/0025 관례.
--       authenticated 쓰기 정책을 만들지 말 것 — LLM 산출물 위조 표면이 된다).
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021/0025 와 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다(0027 PGRST 사고 교훈).
-- 롤백: 0030_project_ai_briefs_rollback.sql — 파생 캐시 전용이라 원본 데이터 손실 없음.
-- 번호: 0029 는 병렬 세션의 task_dependencies 가 선점 — 본 파일은 0029 에 FK·참조·의존이 전혀 없다.
-- 주의: RLS 헬퍼는 public.app_role() (레포 0002/0004 의 옛 current_role() 표기는 2026-07-20 정리됨).
--       (아래 정책은 헬퍼가 필요 없는 구조라 드리프트 무풍이지만, 정책 확장 시 app_role() 만 쓸 것.)
-- 주의: 이 테이블을 다른 조회에 임베드 금지 — 항상 단독 쿼리(minute_insights 2026-07 실사고 규칙).

-- ── AI 브리핑 캐시 본체 ──
-- updated_at 트리거 없음 — 레포 관례(0023 등)대로 앱(service_role upsert)이 직접 갱신한다.
create table if not exists project_ai_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('weekly','risk')),
  cache_key text not null default '',                       -- weekly=base_date ISO, risk=''
  input_hash text not null,                                 -- fnv1a64 — 신선도(stale) 판정의 단일 근거
  headline text not null default '',
  body_md text not null default '',
  items jsonb not null default '[]'::jsonb,
  status text not null check (status in ('ready','none')),
  model text not null default '',                           -- 실제 사용된 모델명(폴백 체인 관측용)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 서버리스 다중 인스턴스 동시 재생성 경합을 행 수준에서 수렴 —
-- upsert onConflict 'project_id,kind,cache_key' 대상(중복 행 원천 차단).
create unique index if not exists project_ai_briefs_project_kind_key_idx
  on project_ai_briefs (project_id, kind, cache_key);

-- ── RLS (enable 이 전제 — 누락 시 기본 GRANT 로 authenticated 쓰기가 열림, 0025 헤더 경고) ──
alter table project_ai_briefs enable row level security;

drop policy if exists project_ai_briefs_read on project_ai_briefs;
create policy project_ai_briefs_read on project_ai_briefs
  for select to authenticated using (true);
-- 쓰기 정책 없음 — service_role 이 RLS 우회로 수행(0021 minute_embeddings·0025 minute_insights 미러).
