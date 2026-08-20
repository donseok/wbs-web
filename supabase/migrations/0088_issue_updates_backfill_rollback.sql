-- 0088 롤백 — 이관 이력만 지운다. 사람이 새로 쓴 이력은 건드리지 않는다.
-- issues.resolution_note 는 0088 이 손대지 않았으므로 원래 값 그대로 남아 있다.

begin;

delete from public.issue_updates where author_name = '(이관)' and kind = 'note';

commit;
