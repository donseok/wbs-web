-- 공정율 기준일(base_date) — null 이면 오늘(Asia/Seoul) = 자동
alter table projects add column if not exists base_date date;
comment on column projects.base_date is '공정율 산정 기준일. null이면 오늘(자동).';
