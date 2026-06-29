insert into teams (code, name) values
  ('PMO','PMO'), ('DT','DT'), ('ERP','ERP'), ('MES','MES')
on conflict (code) do nothing;
