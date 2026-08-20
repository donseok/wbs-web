-- 0087 이후 백필 — 기존 issues.resolution_note 를 첫 이력으로 옮긴다.
--
-- **코드 배포 앞에** 적용한다. 반대로 하면 원본이 소실된다 — 새 코드가 먼저 살아 있는 상태에서
-- 기존 조치메모가 있는 이슈에 경과가 하나 달리면, 미러 재계산이 resolution_note 를 새 본문으로
-- 덮어써 원래 텍스트가 사라지고, 그 뒤 이 백필이 '새 본문'을 원본인 양 이관한다.
-- 이 순서에서는 구 코드가 textarea 로 resolution_note 를 직접 쓰는 창이 잠시 남지만, 이력 행이
-- 원본을 보존하므로 손실이 없고 새 코드의 첫 등록 때 미러가 재계산되어 수렴한다.
--
-- 실측(2026-08-19 프로덕션): 이슈 68건 중 resolution_note 가 채워진 것 1건(49자).
-- 4000자 상한을 넘는 행은 0건이므로 손실 없이 전량 이관된다. 그래도 조건을 명시하는 것은
-- 스테이징·미래의 데이터가 다를 수 있기 때문이다 — 초과분은 남겨 두고 아래 쿼리로 센다.
--
-- 작성자·작성 시각은 추정값이다. author_user_id 는 이슈 작성자, created_at 은
-- issues.updated_at 을 쓴다(담당자만 바꿔도 오르는 값이라 정확하지 않다).
-- 화면은 author_name='(이관)' 을 보고 "이관됨 · 작성 시각 추정"을 표시한다.
--
-- 멱등: 같은 이슈에 이미 '(이관)' 이력이 있으면 건너뛴다. 재적용해도 중복되지 않는다.
-- 롤백: 0088_issue_updates_backfill_rollback.sql

begin;

set search_path = public, extensions;

insert into public.issue_updates
  (issue_id, project_id, kind, category, body, author_user_id, author_name, created_at)
select i.id, i.project_id, 'note', 'action', btrim(i.resolution_note),
       i.created_by, '(이관)', i.updated_at
  from public.issues i
 where btrim(i.resolution_note) <> ''
   and length(btrim(i.resolution_note)) <= 4000
   -- 가드는 '(이관)' 이름이 아니라 **이력 행 존재 여부**로 건다. 이름으로 걸면, 배포 창에서
   -- 사람이 먼저 경과를 하나 쓴 이슈에 대해 미러가 덮어쓴 본문을 원본인 양 한 번 더 이관한다.
   and not exists (
     select 1 from public.issue_updates u where u.issue_id = i.id
   );

-- 이관하지 못한 행(4000자 초과)을 남긴다. 0건이어야 정상이다.
do $$
declare n int;
begin
  select count(*) into n from public.issues
   where btrim(resolution_note) <> '' and length(btrim(resolution_note)) > 4000;
  if n > 0 then
    raise warning '4000자를 넘어 이관하지 못한 조치메모: %건 (resolution_note 에 그대로 남아 있음)', n;
  end if;
end $$;

reset search_path;

commit;
