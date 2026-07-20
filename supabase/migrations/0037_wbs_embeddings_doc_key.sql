-- wbs_embeddings 문서 키 유니크 — 재색인 원자성 개선(전체 삭제 후 재삽입 → upsert + stale 삭제)의 전제.
-- ref_id 가 null 인 문서(프로젝트 요약)도 중복 금지 대상이라 nulls not distinct 사용(프로덕션 PG 17).
-- 사전 중복 정리: (project_id, kind, ref_id)별 최신 (updated_at, id) 1행만 남긴다
-- (2026-07-20 실측 중복 0건 — 신규 환경/재적용 대비 방어).
delete from public.wbs_embeddings e
using public.wbs_embeddings newer
where newer.project_id = e.project_id
  and newer.kind = e.kind
  and newer.ref_id is not distinct from e.ref_id
  and (newer.updated_at, newer.id) > (e.updated_at, e.id);

create unique index if not exists wbs_embeddings_doc_key
  on public.wbs_embeddings (project_id, kind, ref_id) nulls not distinct;
