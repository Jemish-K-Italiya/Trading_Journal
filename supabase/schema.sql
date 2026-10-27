-- Trading Arena schema for Supabase.
-- Run this entire file in Supabase Dashboard > SQL Editor as the project owner.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Trader' check (char_length(display_name) between 1 and 60),
  role text not null default 'trader' check (role in ('admin', 'trader')),
  created_at timestamptz not null default now()
);

create table if not exists public.trader_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  pnl numeric(16, 2),
  return_pct numeric(9, 4),
  win_rate numeric(5, 2) check (win_rate is null or (win_rate >= 0 and win_rate <= 100)),
  completed_trades integer check (completed_trades is null or completed_trades >= 0),
  verified boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Automatically make a profile for each successful auth signup.
-- New signups can never supply their own role: it is always 'trader'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Trader'), 60),
    'trader'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Security-definer helper avoids recursive RLS lookups against profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Prevent a normal user from promoting themselves or changing another user's role.
-- SQL Editor maintenance is allowed because auth.uid() is null in the trusted SQL session.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an administrator can change account roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role_before_update on public.profiles;
create trigger protect_profile_role_before_update
before update on public.profiles
for each row execute procedure public.protect_profile_role();

-- updated_at is maintained by the app for now; this trigger protects direct SQL edits too.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trader_stats_set_updated_at on public.trader_stats;
create trigger trader_stats_set_updated_at
before update on public.trader_stats
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.trader_stats enable row level security;

-- Be explicit about table grants: RLS policies alone do not revoke SQL privileges.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.trader_stats from anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.trader_stats to authenticated;

-- Every signed-in trader may read the public directory fields in profiles.
drop policy if exists "Authenticated users can read trader directory" on public.profiles;
create policy "Authenticated users can read trader directory"
on public.profiles for select to authenticated
using (true);

-- Users can update their own profile. The trigger independently protects the role field.
drop policy if exists "Users update own profile or admins update any profile" on public.profiles;
create policy "Users update own profile or admins update any profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()) or public.is_admin())
with check (id = (select auth.uid()) or public.is_admin());

-- Public-to-authenticated leaderboard data: verified records, own records, and all records for admins.
drop policy if exists "Read verified stats and own stats" on public.trader_stats;
create policy "Read verified stats and own stats"
on public.trader_stats for select to authenticated
using (verified = true or user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins insert trader stats" on public.trader_stats;
create policy "Admins insert trader stats"
on public.trader_stats for insert to authenticated
with check (public.is_admin());

drop policy if exists "Admins update trader stats" on public.trader_stats;
create policy "Admins update trader stats"
on public.trader_stats for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins delete trader stats" on public.trader_stats;
create policy "Admins delete trader stats"
on public.trader_stats for delete to authenticated
using (public.is_admin());


-- Private trading journal: one daily summary per trader/date and multiple trade entries.
create table if not exists public.journal_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trade_date date not null,
  gross_pnl numeric(16,2) not null default 0,
  charges numeric(16,2) not null default 0 check (charges >= 0),
  withdrawal numeric(16,2) not null default 0 check (withdrawal >= 0),
  pnl_mode text not null default 'trades' check (pnl_mode in ('trades', 'manual')),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, trade_date)
);

create table if not exists public.journal_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trade_date date not null,
  symbol text not null check (char_length(symbol) between 1 and 80),
  side text not null check (side in ('LONG', 'SHORT')),
  quantity integer not null check (quantity > 0),
  entry_price numeric(16,4) not null check (entry_price >= 0),
  exit_price numeric(16,4) not null check (exit_price >= 0),
  gross_pnl numeric(16,2) not null,
  charges numeric(16,2) not null default 0 check (charges >= 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_days_user_date_idx on public.journal_days(user_id, trade_date desc);
create index if not exists journal_trades_user_date_idx on public.journal_trades(user_id, trade_date desc);

create or replace trigger journal_days_set_updated_at
before update on public.journal_days
for each row execute procedure public.set_updated_at();
create or replace trigger journal_trades_set_updated_at
before update on public.journal_trades
for each row execute procedure public.set_updated_at();

alter table public.journal_days enable row level security;
alter table public.journal_trades enable row level security;
revoke all on table public.journal_days from anon, authenticated;
revoke all on table public.journal_trades from anon, authenticated;
grant select, insert, update, delete on table public.journal_days to authenticated;
grant select, insert, update, delete on table public.journal_trades to authenticated;

drop policy if exists "Traders manage their own daily journal" on public.journal_days;
create policy "Traders manage their own daily journal"
on public.journal_days for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Traders manage their own trade journal" on public.journal_trades;
create policy "Traders manage their own trade journal"
on public.journal_trades for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));


-- Trading challenges: admins configure the rules; members compete using journal entries.
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  initial_capital numeric(16,2) not null check (initial_capital > 0),
  daily_target_min_pct numeric(8,3) not null default 1 check (daily_target_min_pct >= 0),
  daily_target_max_pct numeric(8,3) not null default 2 check (daily_target_max_pct >= daily_target_min_pct),
  starts_on date not null,
  ends_on date not null,
  expiry_day integer not null default 4 check (expiry_day between 1 and 5),
  market_holidays jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('draft','open','closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists challenges_status_dates_idx on public.challenges(status, starts_on, ends_on);
create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index if not exists challenge_members_user_idx on public.challenge_members(user_id);

create or replace trigger challenges_set_updated_at
before update on public.challenges
for each row execute procedure public.set_updated_at();

alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
revoke all on table public.challenges from anon, authenticated;
revoke all on table public.challenge_members from anon, authenticated;
grant select, insert, update, delete on table public.challenges to authenticated;
grant select, insert, delete on table public.challenge_members to authenticated;

drop policy if exists "Authenticated users can view challenges" on public.challenges;
create policy "Authenticated users can view challenges" on public.challenges
for select to authenticated using (true);
drop policy if exists "Admins manage challenges" on public.challenges;
create policy "Admins manage challenges" on public.challenges
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users can view challenge participants" on public.challenge_members;
create policy "Authenticated users can view challenge participants" on public.challenge_members
for select to authenticated using (true);
drop policy if exists "Users join challenges as themselves" on public.challenge_members;
create policy "Users join challenges as themselves" on public.challenge_members
for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.challenges c where c.id = challenge_id and c.status = 'open')
);
drop policy if exists "Users leave their own challenge or admin removes members" on public.challenge_members;
create policy "Users leave their own challenge or admin removes members" on public.challenge_members
for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Expose challenge performance aggregates only: private journal notes and individual records are never returned.
create or replace function public.get_challenge_daily_results(p_challenge_id uuid)
returns table (
  challenge_id uuid,
  user_id uuid,
  display_name text,
  trade_date date,
  initial_capital numeric,
  daily_target_min_pct numeric,
  daily_target_max_pct numeric,
  gross_pnl numeric,
  charges numeric,
  withdrawal numeric,
  pnl_mode text
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select ch.* from public.challenges ch where ch.id = p_challenge_id
  ), member_dates as (
    select jd.user_id, jd.trade_date
    from public.journal_days jd join public.challenge_members cm on cm.user_id = jd.user_id
    join c on c.id = cm.challenge_id
    where jd.trade_date between c.starts_on and c.ends_on
    union
    select jt.user_id, jt.trade_date
    from public.journal_trades jt join public.challenge_members cm on cm.user_id = jt.user_id
    join c on c.id = cm.challenge_id
    where jt.trade_date between c.starts_on and c.ends_on
  ), trade_totals as (
    select jt.user_id, jt.trade_date, sum(jt.gross_pnl)::numeric as gross, sum(jt.charges)::numeric as fees
    from public.journal_trades jt group by jt.user_id, jt.trade_date
  )
  select c.id, cm.user_id, p.display_name, md.trade_date, c.initial_capital,
    c.daily_target_min_pct, c.daily_target_max_pct,
    case when coalesce(jd.pnl_mode, 'trades') = 'manual' then coalesce(jd.gross_pnl,0) else coalesce(tt.gross,0) end,
    case when coalesce(jd.pnl_mode, 'trades') = 'manual' then coalesce(jd.charges,0) else coalesce(tt.fees,0) end,
    coalesce(jd.withdrawal,0), coalesce(jd.pnl_mode,'trades')
  from c
  join public.challenge_members cm on cm.challenge_id = c.id
  join public.profiles p on p.id = cm.user_id
  join member_dates md on md.user_id = cm.user_id
  left join public.journal_days jd on jd.user_id = md.user_id and jd.trade_date = md.trade_date
  left join trade_totals tt on tt.user_id = md.user_id and tt.trade_date = md.trade_date
  where (select auth.uid()) is not null
  order by cm.user_id, md.trade_date;
$$;
revoke all on function public.get_challenge_daily_results(uuid) from public;
grant execute on function public.get_challenge_daily_results(uuid) to authenticated;
