-- 근태유형에 '반반차'(quarter) 추가.
-- 재택/공가/결근은 등록 옵션(앱 UI)에서만 제외하며, 과거 기록 표시를 위해
-- 제약 조건에는 그대로 남겨둔다.
alter table attendance_records
  drop constraint if exists attendance_records_type_check;
alter table attendance_records
  add constraint attendance_records_type_check
  check (type in ('work','remote','annual','half','quarter','sick','trip','official','absent'));
