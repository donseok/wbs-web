-- 근태 행과 멤버가 반드시 같은 프로젝트에 속하도록 신규 쓰기를 보호한다.
-- 기존 데이터는 챗봇 adapter가 fail-closed로 방어하며, 정리 후 별도 VALIDATE 한다.

create unique index if not exists project_members_id_project_uidx
  on public.project_members (id, project_id);

-- Do not drop/recreate on a rerun: a constraint that operators already validated
-- must never silently return to NOT VALID.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.attendance_records'::regclass
      and conname = 'attendance_member_project_fk'
  ) then
    alter table public.attendance_records
      add constraint attendance_member_project_fk
      foreign key (member_id, project_id)
      references public.project_members (id, project_id)
      on delete cascade
      not valid;
  end if;
end $$;

comment on constraint attendance_member_project_fk on public.attendance_records is
  '신규 근태 쓰기의 멤버/프로젝트 일치를 강제한다. 기존 행 정리 후 VALIDATE CONSTRAINT 실행.';
