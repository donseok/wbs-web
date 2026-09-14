-- supabase/migrations/0095_agent_watchers_no_select.sql
-- 0094 의 agent_watchers_select(using (true)) 는 로그인 사용자 전체가 남의 신원(agent = 이메일 로컬파트/host)을
-- 읽게 한다. 앱은 이 테이블을 service_role 로만 읽으므로(watch 라우트·좌석표 조회) 정책을 지운다.
-- RLS 켜짐 + 정책 없음 = authenticated 접근 없음. 나중에 클라이언트 직접 조회가 필요해지면
-- auth.uid() = user_id 또는 is_project_member(project_id) 로 범위를 좁힌 정책을 새로 만든다.
drop policy if exists agent_watchers_select on public.agent_watchers;
