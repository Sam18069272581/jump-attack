-- Jump Attack 云端备份：每个账号每天一份整库快照（同一天多次同步会覆盖当天那份），只有本人能读写。
-- 在 Supabase 项目左侧的 SQL Editor 里粘贴整段，点 Run。

create table public.backups (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  backup_date date not null,
  updated_at timestamptz not null default now(),
  device text not null,
  schema_version integer not null,
  hash text not null,
  data jsonb not null,
  primary key (user_id, backup_date)
);

alter table public.backups enable row level security;

create policy "own backups: read" on public.backups for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own backups: add" on public.backups for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own backups: replace" on public.backups for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- 没有删除权限：App 删不掉云端的历史备份，只能在 Supabase 控制台里删。

grant select, insert, update on public.backups to authenticated;
