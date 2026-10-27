-- Run in Supabase SQL Editor after the base schema is already installed.

-- Private trading journal: one daily summary per trader/date and multiple trade entries.
create table if not exists public.journal_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trade_date date not null,
  gross_pnl numeric(16,2) not null default 0,
  charges numeric(16,2) not null default 0 check (charges >= 0),
  withdrawal numeric(16,2) not null default 0 check (withdrawal >= 0),
  pnl_mode text not null default 'manual' check (pnl_mode in ('trades', 'manual')),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, trade_date)
);


-- New daily records use the trade ledger by default. Existing rows retain manual mode
-- so historical daily summaries are not silently reinterpreted.
alter table public.journal_days
  alter column pnl_mode set default 'trades';
alter table public.journal_days
  drop constraint if exists journal_days_pnl_mode_check;
alter table public.journal_days
  add constraint journal_days_pnl_mode_check
  check (pnl_mode in ('trades', 'manual'));

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


-- Safe upgrades for databases that already have journal_days.
alter table public.journal_days add column if not exists withdrawal numeric(16,2) not null default 0 check (withdrawal >= 0);
alter table public.journal_days add column if not exists pnl_mode text not null default 'manual' check (pnl_mode in ('trades','manual'));
-- Existing rows receive 'manual' when the column is first added; new rows default to the trade ledger.
alter table public.journal_days alter column pnl_mode set default 'trades';

-- Trading challenges and membership.
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
create or replace trigger challenges_set_updated_at before update on public.challenges for each row execute procedure public.set_updated_at();
alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
revoke all on table public.challenges from anon, authenticated;
revoke all on table public.challenge_members from anon, authenticated;
grant select, insert, update, delete on table public.challenges to authenticated;
grant select, insert, delete on table public.challenge_members to authenticated;
drop policy if exists "Authenticated users can view challenges" on public.challenges;
create policy "Authenticated users can view challenges" on public.challenges for select to authenticated using (true);
drop policy if exists "Admins manage challenges" on public.challenges;
create policy "Admins manage challenges" on public.challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Authenticated users can view challenge participants" on public.challenge_members;
create policy "Authenticated users can view challenge participants" on public.challenge_members for select to authenticated using (true);
drop policy if exists "Users join challenges as themselves" on public.challenge_members;
create policy "Users join challenges as themselves" on public.challenge_members for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.challenges c where c.id = challenge_id and c.status = 'open'));
drop policy if exists "Users leave their own challenge or admin removes members" on public.challenge_members;
create policy "Users leave their own challenge or admin removes members" on public.challenge_members for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create or replace function public.get_challenge_daily_results(p_challenge_id uuid)
returns table (challenge_id uuid,user_id uuid,display_name text,trade_date date,initial_capital numeric,daily_target_min_pct numeric,daily_target_max_pct numeric,gross_pnl numeric,charges numeric,withdrawal numeric,pnl_mode text)
language sql stable security definer set search_path = public as $$
  with c as (select ch.* from public.challenges ch where ch.id = p_challenge_id),
  member_dates as (
    select jd.user_id,jd.trade_date from public.journal_days jd join public.challenge_members cm on cm.user_id=jd.user_id join c on c.id=cm.challenge_id where jd.trade_date between c.starts_on and c.ends_on
    union select jt.user_id,jt.trade_date from public.journal_trades jt join public.challenge_members cm on cm.user_id=jt.user_id join c on c.id=cm.challenge_id where jt.trade_date between c.starts_on and c.ends_on
  ), trade_totals as (select jt.user_id,jt.trade_date,sum(jt.gross_pnl)::numeric gross,sum(jt.charges)::numeric fees from public.journal_trades jt group by jt.user_id,jt.trade_date)
  select c.id,cm.user_id,p.display_name,md.trade_date,c.initial_capital,c.daily_target_min_pct,c.daily_target_max_pct,
  case when coalesce(jd.pnl_mode,'trades')='manual' then coalesce(jd.gross_pnl,0) else coalesce(tt.gross,0) end,
  case when coalesce(jd.pnl_mode,'trades')='manual' then coalesce(jd.charges,0) else coalesce(tt.fees,0) end,
  coalesce(jd.withdrawal,0),coalesce(jd.pnl_mode,'trades')
  from c join public.challenge_members cm on cm.challenge_id=c.id join public.profiles p on p.id=cm.user_id join member_dates md on md.user_id=cm.user_id
  left join public.journal_days jd on jd.user_id=md.user_id and jd.trade_date=md.trade_date left join trade_totals tt on tt.user_id=md.user_id and tt.trade_date=md.trade_date
  where (select auth.uid()) is not null order by cm.user_id,md.trade_date;
$$;
revoke all on function public.get_challenge_daily_results(uuid) from public;
grant execute on function public.get_challenge_daily_results(uuid) to authenticated;
