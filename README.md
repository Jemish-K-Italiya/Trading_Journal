# Trading Arena

A minimalist, professional trading community built with Next.js, Supabase Auth/Postgres, and CSS. Designed for GitHub source control and Vercel deployment.

## Included

- Responsive dark dashboard without a social feed
- Email/password sign up and sign in via Supabase Auth
- Automatic trader profile creation on signup
- Trader directory and leaderboard
- Leaderboard ranks only records whose performance is explicitly marked verified
- Admin-only performance entry/edit interface
- Private daily trading journal with trade-ledger mode by default and optional manual daily P&L mode; selected mode is the only source used in the daily total, preventing double-counting
- Admin challenge configuration with initial capital, daily target percentage bands, start/end dates, weekly expiry day, market holiday calendar, and draft/active/completed status
- Individual trade records with symbol, side, quantity, entry/exit prices, gross P&L, charges, net P&L, and trade notes
- Per-user Row Level Security for private journal records
- Row Level Security (RLS) policies for trader profiles and performance records
- Founder/admin bootstrap flow that does not expose an admin signup option

**Important:** Performance metrics are entered manually by an administrator in this starter release. There is no broker connection, automated trade import, or independent audit of metrics. Verify the source before selecting “Mark as verified.”

## Stack

- Next.js App Router + TypeScript
- React
- Supabase Auth, PostgreSQL, and Row Level Security
- `@supabase/ssr` for cookie-based sessions
- `lucide-react` icons

## 1. Create the Supabase project

1. Create a project at [Supabase](https://supabase.com/).
2. Open **SQL Editor** and run the entire `supabase/schema.sql` file.
3. (Only for databases created from an older schema) run `supabase/journal-migration.sql`. It is safe to re-run and also creates the journal and challenge tables if missing. A fresh install of `schema.sql` already includes everything.
4. Open **Project Settings → API** and copy the project URL and publishable key. A legacy anon key can also be used as the public client key, but never put a `service_role` key in browser-visible environment variables.

## 2. Set up the project locally

Install Node.js 20.9 or newer. Then from this folder run:

```bash
npm install
```

Copy `.env.example` to `.env.local` and set the real Supabase values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Run the application:

```bash
npm run dev
```

Open <http://localhost:3000>.

## 3. Create and promote the founder account

1. Register the founder account through `/login` → **Create an account**. Use the email address that should own the platform.
2. If email confirmation is enabled in Supabase, confirm the email first.
3. In Supabase **SQL Editor**, open `supabase/bootstrap-admin.sql`, replace `founder@example.com` with the founder's actual email and run it.
4. Confirm the row shows `role = 'admin'` using the optional verification query at the bottom of that file.
5. Sign out and sign back in or refresh the application. The Admin panel should now be available.
6. Only after confirming the founder account is an admin, make public signups available as required.

The SQL trigger creates all future accounts with the `trader` role. Users cannot grant themselves admin access through the signup form or by editing their own profile.

## 4. Configure Supabase Auth URLs

In Supabase **Authentication → URL Configuration**, configure:

- Site URL for local work: `http://localhost:3000`
- Redirect URL: `http://localhost:3000/auth/callback`

After deployment, add the exact Vercel URL and callback URL, for example:

- `https://YOUR-APP.vercel.app`
- `https://YOUR-APP.vercel.app/auth/callback`

If you use a custom domain, add that domain and callback URL too.

## 5. Push to GitHub

Create an empty GitHub repository, then run these commands from this project folder:

```bash
git init
git add .
git commit -m "Initial Trading Arena app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Do not commit `.env.local`; it is ignored by `.gitignore`.

## 6. Deploy on Vercel

1. Sign in at [Vercel](https://vercel.com/) and select **Add New → Project**.
2. Import your GitHub repository.
3. In project environment variables, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (a legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works) for Production, Preview and Development. These are inlined at build time, so **redeploy after adding or changing them**.
4. Keep the framework preset as **Next.js**, then deploy.
5. Add the Vercel domain and `/auth/callback` redirect URL in Supabase Auth settings.
6. Test signup, email confirmation/login, profile creation, directory visibility, and admin access in the deployed build.

Vercel automatically creates deployments for pushes to the connected GitHub repository.

## Data model

- `profiles`: display name, role, signup timestamp. Email is not stored in this publicly readable table.
- `trader_stats`: manually maintained P&L, return percentage, win rate, completed trade count, verification status, and update timestamp.

Non-admin authenticated users can read the directory and only verified performance records (plus their own performance record). Only an admin may insert/update/delete performance metrics. Table grants and RLS policies are both set in the SQL.

## Security and release notes

- Never expose Supabase `service_role` or secret keys in `NEXT_PUBLIC_*` variables.
- Role assignment is done through a trusted Supabase SQL Editor session. The app deliberately has no public admin-claim flow.
- Admin route access is checked server-side, and database access is independently constrained by RLS.
- This app is an initial platform foundation, not a broker-integrated trading system. It does not calculate returns, verify broker statements, execute trades, or provide investment advice.
- Before production launch, configure Supabase email templates and rate limits, test RLS with separate trader/admin accounts, and consider adding audit logging for admin changes.


## Trading journal

Open **Journal** from the sidebar to save daily notes, withdrawals, and multiple individual trade records. **Trade ledger** is the default P&L source: daily gross P&L and charges are aggregated from that date’s individual trades. **Manual daily entry** is an alternative for days when you do not itemise trades. The selected source alone contributes to daily net P&L; it is never added to the other source. When manual mode is selected, trade records remain available for reference but do not contribute to the daily summary. Journal rows and notes are private to their owner through Supabase Row Level Security. Values are manually entered; no broker integration or automatic brokerage calculation is included.

## Trading challenges

Open **Challenges** from the sidebar. An administrator can create a challenge with its name, initial capital per trader, daily target lower/upper bands (percentage of the opening balance), start and end dates, weekly expiry day, and market holidays. Traders can join open challenges. Challenge standings are calculated from logged journal dates in the challenge window, using the selected P&L source for each day. The database RPC returns only challenge metrics, not private daily notes or individual trade details. The holiday list is stored as challenge configuration; the current standings aggregate logged days and do not synthesize missing holiday/no-trade rows.


## Challenge configuration

After promoting the founder account to admin, open **Admin panel → Challenge setup**. The administrator can create/update the single active challenge with:
- Challenge name and initial capital per trader
- Daily target lower and upper bands as percentages of that day's opening balance
- Start and end dates
- Weekly expiry day (Monday–Friday)
- Market holidays in `YYYY-MM-DD Holiday name` format
- Draft, open (joinable), or closed status

The challenge form saves to `public.challenges`, protected by RLS so only admins can create or change the configuration. The admin panel supports multiple challenge records. Challenge enrollment and daily result calculation are supported by the database schema; the full challenge-specific leaderboard/balance-curve interface is a follow-on UI item and is not yet wired into the standard leaderboard.

## Preventing daily P&L double counting

The Journal uses **Trade ledger (recommended)** as the default P&L source. Gross P&L and charges are derived from individual trade rows for the selected date; the daily summary fields are read-only in this mode. Select **Manual daily entry** only when you want to record a day's totals without using individual trade rows. Each day stores its selected source. Do not add the manual daily summary and the individual trade totals together in reports.

Existing daily records retain `manual` mode so their historical values are preserved; newly created days default to `trades` mode. Daily notes remain separate from P&L calculations.
