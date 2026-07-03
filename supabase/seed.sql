insert into teams (code, name) values
  ('PMO','PMO'), ('가공','가공'), ('ERP','ERP'), ('MES','MES')
on conflict (code) do nothing;
