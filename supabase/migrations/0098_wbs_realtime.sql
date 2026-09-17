-- WBS 실시간 반영 — 단계·실적이 실제로 바뀐 행을 프로젝트 private 채널로 broadcast.
--
-- 왜 트리거인가: 에이전트는 RPC(apply_workflow_event)로, 사람은 Server Action 으로 같은
-- wbs_items UPDATE 에 도달한다. 애플리케이션 층에서 송신하면 RPC 경로를 놓친다. 한 지점에서
-- 양쪽을 모두 잡으려면 DB 트리거여야 한다.
--
-- 핵심 계약
--   1) postgres_changes 를 쓰지 않는다 — 0075 의 근거를 그대로 승계한다. 구독자 수 비례
--      RLS 재검사가 Micro 컴퓨트(2vCPU 공유·1GB)에 불리하다. realtime.send(broadcast) 는
--      구독자가 몇이든 송신 1회로 끝난다.
--   2) 송신은 향상 계층이다 — 실패해도 본 UPDATE 를 되돌리지 않는다(예외 삼킴).
--      실시간은 편의이고 기록이 본질이다.
--   3) `of` 절과 `when` 절을 둘 다 둔다. 전자는 무관한 컬럼 수정에서 트리거를 아예 깨우지
--      않고, 후자는 같은 값 재기록(UPDATE 는 됐지만 값은 그대로)을 걸러낸다.
--   4) 채널은 private — realtime.messages 의 select 정책이 프로젝트 멤버만 통과시킨다.
--      판정은 기존 public.is_project_member(uuid) 에 위임한다. 멤버십 서브쿼리를 여기
--      인라인하면 0052·0053 과 규칙이 갈라진다.
--   5) 페이로드에는 wbs_items 의 SELECT 정책이 전면 개방(0002 read_all_items = using(true))
--      이라 프로젝트 멤버 전원이 이미 읽을 수 있는 값만 싣는다. **그 정책이 좁아지면 이
--      페이로드도 같이 좁혀야 한다** — 그 경우 {id, project_id, updated_at} 만 보내고 각
--      화면이 해당 행 1건을 재조회하는 형태로 바꾼다.
--   6) updated_at 을 싣는 이유는 순서 판정이다. broadcast 는 전송 순서를 보장하지 않으므로
--      클라이언트가 보유 행보다 오래된 페이로드를 버려야 한다. stage·actual_pct 를 바꾸는
--      앱·RPC 경로가 모두 updated_at 을 함께 쓴다는 것을 확인했다(2026-09-17 전수 조사).
--
-- 멱등: 반복 실행 안전. 적용: Supabase Management API(npm run db:apply).
-- 롤백: 0098_wbs_realtime_rollback.sql — 실시간만 꺼진다. 저장·조회·기존 갱신 경로는 무영향.

begin;

set search_path = public, extensions;

create or replace function public.wbs_items_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'id',         new.id,
        'project_id', new.project_id,
        'stage',      new.stage,
        'actual_pct', new.actual_pct,
        'updated_at', new.updated_at
      ),
      'wbs_changed',
      'project-' || new.project_id::text || '-wbs',
      true  -- private 채널
    );
  exception when others then
    null;  -- 송신 실패는 삼킨다 — 본 UPDATE 를 지키는 것이 우선
  end;
  return new;
end;
$$;

drop trigger if exists wbs_items_broadcast on public.wbs_items;
create trigger wbs_items_broadcast
  after update of stage, actual_pct on public.wbs_items
  for each row
  when (old.stage is distinct from new.stage
        or old.actual_pct is distinct from new.actual_pct)
  execute function public.wbs_items_broadcast();

-- private 채널 수신 인가 — 토픽에서 뽑은 project_id 로 멤버십을 판정한다.
-- 알림(0075)은 토픽에 auth.uid() 가 박혀 있어 등식 비교로 끝났지만, 여기는 프로젝트 범위라
-- 멤버십 판정이 필요하다.
--
-- ⚠ uuid 캐스트를 날로 쓰지 않는다. `substring(realtime.topic() from 9 for 36)::uuid` 는
-- 형식이 어긋난 토픽에서 예외를 던지고, **RLS 정책 안의 예외는 false 가 아니라 오류**다.
-- 정규식 substring 은 불일치에서 NULL 을 돌려주므로 캐스트가 아예 실행되지 않는다. 여기에
-- `is not null` 을 함께 둬서 플래너가 조건 순서를 바꿔도 결과가 흔들리지 않게 한다
-- (is_project_member(null) 은 슈퍼유저에게 true 가 될 수 있다).
drop policy if exists receive_project_wbs_channel on realtime.messages;
create policy receive_project_wbs_channel on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and substring(realtime.topic() from
          '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'
        ) is not null
    and public.is_project_member(
          (substring(realtime.topic() from
            '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'
          ))::uuid
        )
  );

reset search_path;

commit;
