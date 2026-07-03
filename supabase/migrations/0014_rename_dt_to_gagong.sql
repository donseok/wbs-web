-- 담당 팀 'DT' → '가공' 전면 개명 (2026-07-03)
-- 코드(TeamCode)와 DB(teams.code/name, sub-act 이름)를 함께 변경한다.
-- 주의: 이 파일은 프로덕션에 Management API로 직접 적용됨(레포 기록용).

begin;

-- 1) teams: check 제약 교체 후 코드/이름 변경
alter table teams drop constraint teams_code_check;
update teams set code = '가공', name = '가공' where code = 'DT';
alter table teams add constraint teams_code_check
  check (code in ('PMO','가공','ERP','MES'));

-- 2) 담당별 sub-act 이름의 "(DT 주관/지원)" 표기 갱신
update wbs_items
set name = replace(replace(name, '(DT 주관)', '(가공 주관)'), '(DT 지원)', '(가공 지원)'),
    updated_at = now()
where name like '%(DT 주관)%' or name like '%(DT 지원)%';

-- 3) 이름이 바뀐 항목이 속한 프로젝트의 DK Bot 색인 초기화(다음 질문 시 self-heal 재색인)
delete from wbs_embeddings;

commit;
