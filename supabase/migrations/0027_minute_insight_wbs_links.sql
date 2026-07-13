-- AI 액션 아이템과 WBS 작업의 명시적 연결
create table if not exists minute_insight_wbs_links (
  insight_id uuid primary key references minute_insights(id) on delete cascade,
  wbs_item_id uuid not null references wbs_items(id) on delete cascade,
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now()
);
create index if not exists minute_insight_wbs_links_wbs_idx on minute_insight_wbs_links(wbs_item_id);
alter table minute_insight_wbs_links enable row level security;
drop policy if exists minute_insight_wbs_links_read on minute_insight_wbs_links;
create policy minute_insight_wbs_links_read on minute_insight_wbs_links for select to authenticated using (true);
drop policy if exists minute_insight_wbs_links_write on minute_insight_wbs_links;
create policy minute_insight_wbs_links_write on minute_insight_wbs_links for all to authenticated
  using (app_role() is not null) with check (app_role() is not null and linked_by = auth.uid());
