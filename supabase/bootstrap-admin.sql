-- ONE-TIME ADMIN BOOTSTRAP
-- 1. Sign up with the founder email first.
-- 2. Replace founder@example.com below with that exact email address.
-- 3. Run this statement in Supabase Dashboard > SQL Editor as the project owner.
-- 4. Confirm exactly one row was updated. Do not expose SQL Editor access to users.

update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where lower(email) = lower('founder@example.com')
);

-- Optional verification:
-- select p.display_name, u.email, p.role
-- from public.profiles p join auth.users u on u.id = p.id
-- where lower(u.email) = lower('founder@example.com');
