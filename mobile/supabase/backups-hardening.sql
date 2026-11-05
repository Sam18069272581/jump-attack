-- Jump Attack 云端备份加固（2026-11 安全检查）：在 backups.sql 之后跑一次。
-- 在 Supabase 项目左侧的 SQL Editor 里粘贴整段，点 Run，重复跑也没关系。App 本来就只写当天那份，跑完照常同步；
-- 只有比云端备份旧的 App 版本会被拒（第 3 条）。
--
-- 1. updated_at 由服务器填，App 传的设备时间会被换掉。每台设备都拿「最新一份」比对，而最新按 updated_at 排；
--    按设备时间排，一台时钟快的设备传的那份会一直排在最前，别的手机下次同步就下载它，盖掉刚记的数据。
-- 2. 只能写今天前后一天那份，别的日期的备份只能读（包括时钟快的设备以前标在将来的）。云端历史是出问题后
--    最后的退路，时钟不准的设备、某个版本的 bug 或泄露的密码都不能再把它改空。
-- 3. 比云端已有备份旧的 App 版本不能写：它读不了新版本加的表和列，传上去就把它们丢了。
-- 4. 单份备份不超过 20 MB。这只限单份：一个账号每天还能再写一份，挡住陌生人灌满免费额度靠的是关掉开放注册
--    （Authentication → Sign In / Providers → Allow new users to sign up），队友的账号由你在 Users 里建。
--
-- 整段在一个事务里：中途出错就什么都不改。

begin;

-- 1
create or replace function public.backups_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 跑到提交前不让 App 写：正在写的先写完再重置，之后的等触发器和新规则建好再写，不会有一份漏掉重置。
lock table public.backups in share row exclusive mode;
drop trigger if exists backups_stamp on public.backups;
-- 已经被时钟快的设备标在将来的备份，时间改到现在之前，之后再传的才能排到它们前面。按原来的先后错开 1 微秒：
-- 每台手机上次同步的都是原来最新的那份，它还得是最新的，不然手机会以为云端变了，下载一份旧的盖掉自己。
update public.backups b set updated_at = now() - r.n * interval '1 microsecond'
  from (
    select user_id, backup_date, row_number() over (partition by user_id order by updated_at desc) as n
    from public.backups where updated_at > now()
  ) r
  where b.user_id = r.user_id and b.backup_date = r.backup_date;
create trigger backups_stamp before insert or update on public.backups
  for each row execute function public.backups_stamp();

-- 3 要知道这个账号云端已有的最高版本。策略里直接查 backups 会再套用 backups 自己的策略（Postgres 报 infinite recursion），
--   所以放进一个以表主人身份运行的函数：只读当前登录账号自己的行，放在不对外开放的 private schema 里。
create schema if not exists private;
create or replace function private.backups_newest_schema() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(max(schema_version), 0) from public.backups where user_id = (select auth.uid());
$$;
revoke all on function private.backups_newest_schema() from public;
grant usage on schema private to authenticated;
grant execute on function private.backups_newest_schema() to authenticated;

-- 2、3
drop policy if exists "own backups: add" on public.backups;
drop policy if exists "own backups: replace" on public.backups;
create policy "own backups: add" on public.backups for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and backup_date between current_date - 1 and current_date + 1
    and schema_version >= (select private.backups_newest_schema())
  );
create policy "own backups: replace" on public.backups for update to authenticated
  using ((select auth.uid()) = user_id and backup_date between current_date - 1 and current_date + 1)
  with check (
    (select auth.uid()) = user_id
    and backup_date between current_date - 1 and current_date + 1
    and schema_version >= (select private.backups_newest_schema())
  );

-- 4（not valid：已有的备份不查，这一句不会因为以前的数据失败）
alter table public.backups drop constraint if exists backups_size;
alter table public.backups add constraint backups_size
  check (octet_length(data::text) < 20 * 1024 * 1024) not valid;

commit;
