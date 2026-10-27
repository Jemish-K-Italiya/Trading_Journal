"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity, ArrowUpRight, BarChart3, Check, ChevronDown,
  BookOpen, CircleHelp, Flag, LayoutDashboard, LogOut, Menu, Search, Settings,
  ShieldCheck, SlidersHorizontal, Trophy, UserRound, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TradingJournalView from "@/components/trading-journal";
import ChallengeSettings from "@/components/challenge-settings";
import ChallengesView from "@/components/challenges-view";

type Profile = {
  id: string;
  display_name: string;
  role: "admin" | "trader";
  created_at: string;
};

type TraderStats = {
  user_id: string;
  pnl: number | null;
  return_pct: number | null;
  win_rate: number | null;
  completed_trades: number | null;
  verified: boolean;
  updated_at: string;
};

type DraftStats = {
  pnl: string;
  return_pct: string;
  win_rate: string;
  completed_trades: string;
  verified: boolean;
};

const navItems = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
  { label: "Journal", href: "/journal", icon: BookOpen },
  { label: "Challenges", href: "/challenges", icon: Flag },
  { label: "Traders", href: "/traders", icon: Users },
  { label: "Account", href: "/account", icon: Settings },
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "T").join("") || "T";
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

function formattedDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function sortProfiles(profiles: Profile[], statsById: Map<string, TraderStats>) {
  return [...profiles].sort((a, b) => {
    const aStats = statsById.get(a.id);
    const bStats = statsById.get(b.id);
    const aRanked = Boolean(aStats?.verified && aStats.return_pct !== null);
    const bRanked = Boolean(bStats?.verified && bStats.return_pct !== null);
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked && bRanked) return Number(bStats?.return_pct) - Number(aStats?.return_pct);
    return a.display_name.localeCompare(b.display_name);
  });
}

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [stats, setStats] = useState<TraderStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftStats>({ pnl: "", return_pct: "", win_rate: "", completed_trades: "", verified: false });
  const [savingStats, setSavingStats] = useState(false);

  const loadData = useCallback(async () => {
    setAppError("");
    try {
      const supabase = createClient();
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userResult.user) {
        router.replace("/login");
        return;
      }
      setUser({ id: userResult.user.id, email: userResult.user.email });
      const [{ data: ownProfile, error: ownError }, { data: allProfiles, error: profilesError }, { data: statsRows, error: statsError }] = await Promise.all([
        supabase.from("profiles").select("id,display_name,role,created_at").eq("id", userResult.user.id).maybeSingle(),
        supabase.from("profiles").select("id,display_name,role,created_at").order("created_at", { ascending: true }),
        supabase.from("trader_stats").select("user_id,pnl,return_pct,win_rate,completed_trades,verified,updated_at"),
      ]);
      if (ownError) throw ownError;
      if (profilesError) throw profilesError;
      if (statsError) throw statsError;
      if (!ownProfile) throw new Error("Your trader profile is not ready yet. Refresh the page in a moment.");
      const cleanProfiles = (allProfiles ?? []) as Profile[];
      setProfile(ownProfile as Profile);
      setDisplayName((ownProfile as Profile).display_name ?? "");
      setProfiles(cleanProfiles);
      setStats((statsRows ?? []) as TraderStats[]);
    } catch (caught) {
      setAppError(caught instanceof Error ? caught.message : "Unable to load your dashboard. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Auth is checked once on page entry; protected database operations still use RLS.
  useEffect(() => {
    void loadData();
  }, [loadData]);

  const statsById = useMemo(() => new Map(stats.map((item) => [item.user_id, item])), [stats]);
  const sortedProfiles = useMemo(() => sortProfiles(profiles, statsById), [profiles, statsById]);
  const verifiedRankedProfiles = useMemo(() => sortedProfiles.filter((item) => {
    const metric = statsById.get(item.id);
    return Boolean(metric?.verified && metric.return_pct !== null);
  }), [sortedProfiles, statsById]);
  const currentRank = user ? verifiedRankedProfiles.findIndex((item) => item.id === user.id) + 1 : 0;
  const ownStats = user ? statsById.get(user.id) : undefined;
  const filteredProfiles = useMemo(() => profiles.filter((item) => item.display_name.toLowerCase().includes(searchQuery.trim().toLowerCase())), [profiles, searchQuery]);

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/": { title: "Overview", subtitle: "Your trading workspace at a glance." },
    "/leaderboard": { title: "Leaderboard", subtitle: "Compare verified trading performance across the arena." },
    "/journal": { title: "Trading Journal", subtitle: "Log daily P&L, charges, trades, and execution notes." },
    "/challenges": { title: "Trading Challenges", subtitle: "Join structured challenges with capital rules and daily target bands." },
    "/traders": { title: "Traders", subtitle: "A clear directory of the people in your trading arena." },
    "/account": { title: "Account", subtitle: "Manage your profile and account preferences." },
    "/admin": { title: "Admin", subtitle: "Manage performance records and platform visibility." },
  };
  const page = pageTitles[pathname] ?? pageTitles["/"];

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !displayName.trim()) return;
    setSavingProfile(true); setAppError(""); setSuccess("");
    try {
      const supabase = createClient();
      const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() }).eq("id", user.id);
      if (error) throw error;
      setSuccess("Profile updated successfully.");
      await loadData();
    } catch (caught) {
      setAppError(caught instanceof Error ? caught.message : "Could not save profile.");
    } finally { setSavingProfile(false); }
  }

  function startEditing(trader: Profile) {
    const current = statsById.get(trader.id);
    setEditingId(trader.id);
    setDraft({
      pnl: current?.pnl === null || current?.pnl === undefined ? "" : String(current.pnl),
      return_pct: current?.return_pct === null || current?.return_pct === undefined ? "" : String(current.return_pct),
      win_rate: current?.win_rate === null || current?.win_rate === undefined ? "" : String(current.win_rate),
      completed_trades: current?.completed_trades === null || current?.completed_trades === undefined ? "" : String(current.completed_trades),
      verified: current?.verified ?? false,
    });
    setSuccess(""); setAppError("");
  }

  async function saveTraderStats(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    const numberOrNull = (value: string) => value.trim() === "" ? null : Number(value);
    const pnl = numberOrNull(draft.pnl);
    const returnPct = numberOrNull(draft.return_pct);
    const winRate = numberOrNull(draft.win_rate);
    const completedTrades = numberOrNull(draft.completed_trades);
    if ([pnl, returnPct, winRate, completedTrades].some((value) => value !== null && !Number.isFinite(value))) {
      setAppError("Enter valid numeric values for each metric."); return;
    }
    if (winRate !== null && (winRate < 0 || winRate > 100)) { setAppError("Win rate must be between 0 and 100."); return; }
    if (completedTrades !== null && (!Number.isInteger(completedTrades) || completedTrades < 0)) { setAppError("Completed trades must be a whole number of zero or more."); return; }
    setSavingStats(true); setAppError(""); setSuccess("");
    try {
      const supabase = createClient();
      const { error } = await supabase.from("trader_stats").upsert({
        user_id: editingId,
        pnl,
        return_pct: returnPct,
        win_rate: winRate,
        completed_trades: completedTrades,
        verified: draft.verified,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      setEditingId(null);
      setSuccess("Performance record saved.");
      await loadData();
    } catch (caught) {
      setAppError(caught instanceof Error ? caught.message : "Could not save performance record.");
    } finally { setSavingStats(false); }
  }

  if (loading) {
    return <main className="loading-screen"><span className="brand-mark"><BarChart3 size={22} /></span><span className="loading-label">Loading your workspace</span><span className="loading-bar" /></main>;
  }

  const isAdmin = profile?.role === "admin";
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <Link href="/" className="brand-lockup sidebar-brand" onClick={() => setMobileNavOpen(false)}>
          <span className="brand-mark"><BarChart3 size={21} strokeWidth={2.4} /></span>
          <span>TRADING<span className="brand-light">ARENA</span></span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} className={`nav-link ${isActive(href) ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{href === "/leaderboard" && <span className="nav-indicator" />}
            </Link>
          ))}
          {isAdmin && <><div className="nav-divider" /><div className="workspace-label admin-label">ADMINISTRATION</div><Link href="/admin" onClick={() => setMobileNavOpen(false)} className={`nav-link ${isActive("/admin") ? "nav-link-active" : ""}`}><ShieldCheck size={18} strokeWidth={1.8} /><span>Admin panel</span></Link></>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className="live-dot" /><div><strong>Platform status</strong><span>Connected</span></div><span className="status-check"><Check size={13} /></span></div>
          <button className="profile-mini" onClick={() => router.push("/account")}>
            <span className="avatar avatar-small">{initials(profile?.display_name ?? "Trader")}</span>
            <span className="profile-mini-text"><strong>{profile?.display_name ?? "Trader"}</strong><small>{isAdmin ? "Admin · Trader" : "Trader account"}</small></span>
            <ChevronDown size={15} className="muted-icon" />
          </button>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{page.title}</strong></div></div>
          <div className="topbar-right"><div className="header-status"><span className="live-dot" /> Live workspace</div><button className="icon-button" aria-label="Help information" title="Trading performance is not investment advice"><CircleHelp size={18} /></button><button className="topbar-avatar" onClick={() => router.push("/account")} title="Account">{initials(profile?.display_name ?? "Trader")}</button></div>
        </header>

        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow">TRADING ARENA / {pathname === "/" ? "WORKSPACE" : page.title.toUpperCase()}</div><h1>{pathname === "/" ? `Good to see you, ${profile?.display_name?.split(" ")[0] ?? "Trader"}.` : page.title}</h1><p>{pathname === "/" ? "A clear picture of your place in the arena." : page.subtitle}</p></div><div className="heading-date"><span className="date-label">TODAY</span><strong>{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</strong></div></div>

          {appError && <div className="notice notice-error global-notice" role="alert">{appError}<button className="notice-close" onClick={() => setAppError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
          {success && <div className="notice notice-success global-notice" role="status">{success}<button className="notice-close" onClick={() => setSuccess("")} aria-label="Dismiss message"><X size={15} /></button></div>}

          {pathname === "/" && <>
            <section className="metric-grid">
              <div className="metric-card"><div className="metric-top"><span>Total traders</span><span className="metric-icon"><Users size={17} /></span></div><div className="metric-value">{profiles.length}</div><div className="metric-foot"><span className="metric-neutral">Registered accounts</span><span className="metric-caption">All members</span></div></div>
              <div className="metric-card"><div className="metric-top"><span>Verified traders</span><span className="metric-icon"><ShieldCheck size={17} /></span></div><div className="metric-value">{verifiedRankedProfiles.length}</div><div className="metric-foot"><span className="metric-neutral">Performance checked</span><span className="metric-caption">Rank eligible</span></div></div>
              <div className="metric-card"><div className="metric-top"><span>Your rank</span><span className="metric-icon"><Trophy size={17} /></span></div><div className="metric-value">{currentRank > 0 ? `#${currentRank}` : "—"}</div><div className="metric-foot"><span className="metric-neutral">{currentRank > 0 ? "Verified leaderboard" : "Awaiting verified metrics"}</span></div></div>
              <div className="metric-card"><div className="metric-top"><span>Your P&L</span><span className="metric-icon"><Activity size={17} /></span></div><div className={`metric-value ${ownStats?.verified && (ownStats.pnl ?? 0) > 0 ? "positive" : ownStats?.verified && (ownStats.pnl ?? 0) < 0 ? "negative" : ""}`}>{ownStats?.verified ? formatMoney(ownStats.pnl) : "—"}</div><div className="metric-foot"><span className="metric-neutral">{ownStats?.verified ? "Verified record" : "No verified record yet"}</span></div></div>
            </section>
            <section className="content-grid">
              <div className="panel panel-large"><div className="panel-heading"><div><h2>Leaderboard snapshot</h2><p>Based on verified returns only</p></div><Link className="text-link" href="/leaderboard">Full leaderboard <ArrowUpRight size={15} /></Link></div>
                {verifiedRankedProfiles.length === 0 ? <div className="empty-state"><span className="empty-icon"><Trophy size={22} /></span><h3>No ranked traders yet</h3><p>Verified performance records will appear here when an administrator adds them.</p><Link className="button button-secondary button-small" href={isAdmin ? "/admin" : "/leaderboard"}>{isAdmin ? "Add performance data" : "View leaderboard"}</Link></div> : <div className="table-wrap"><table><thead><tr><th>RANK</th><th>TRADER</th><th>RETURN</th><th>NET P&L</th><th>WIN RATE</th></tr></thead><tbody>{verifiedRankedProfiles.slice(0, 5).map((trader, index) => { const metric = statsById.get(trader.id)!; return <tr key={trader.id}><td><span className={`rank-number ${index < 3 ? "rank-top" : ""}`}>{String(index + 1).padStart(2, "0")}</span></td><td><div className="trader-cell"><span className="avatar">{initials(trader.display_name)}</span><span><strong>{trader.display_name}{trader.id === user?.id ? <em className="you-tag">YOU</em> : null}</strong><small>{trader.role === "admin" ? "Admin trader" : "Arena trader"}</small></span></div></td><td className={Number(metric.return_pct) >= 0 ? "positive" : "negative"}>{formatPercent(metric.return_pct)}</td><td>{formatMoney(metric.pnl)}</td><td>{metric.win_rate == null ? "—" : `${Number(metric.win_rate).toFixed(1)}%`}</td></tr>; })}</tbody></table></div>}
              </div>
              <div className="panel panel-side"><div className="panel-heading"><div><h2>Recently joined</h2><p>Latest trader accounts</p></div><Users size={17} className="muted-icon" /></div>
                <div className="recent-list">{[...profiles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5).map((trader) => <div className="recent-row" key={trader.id}><span className="avatar">{initials(trader.display_name)}</span><div className="recent-info"><strong>{trader.display_name}{trader.id === user?.id ? <em className="you-tag">YOU</em> : null}</strong><small>Joined {formattedDate(trader.created_at)}</small></div><span className="member-dot" title="Registered trader" /> </div>)}</div>
                <Link className="panel-footer-link" href="/traders">Browse all traders <ArrowUpRight size={15} /></Link>
              </div>
            </section>
            <div className="footnote"><ShieldCheck size={15} /><span>Performance is shown as verified only when an administrator marks the record as verified. Metrics are not connected to a broker by default.</span></div>
          </>}

          {pathname === "/journal" && <TradingJournalView />}

          {pathname === "/challenges" && <ChallengesView />}

          {pathname === "/leaderboard" && <section className="panel"><div className="panel-heading"><div><h2>Trader rankings</h2><p>Unverified or missing metrics are intentionally not ranked.</p></div><span className="count-pill">{verifiedRankedProfiles.length} ranked</span></div>
            {sortedProfiles.length === 0 ? <div className="empty-state"><span className="empty-icon"><Users size={22} /></span><h3>No traders yet</h3><p>Registered traders will appear once they create an account.</p></div> : <div className="table-wrap"><table><thead><tr><th>RANK</th><th>TRADER</th><th>RETURN</th><th>NET P&L</th><th>WIN RATE</th><th>TRADES</th><th>STATUS</th></tr></thead><tbody>{sortedProfiles.map((trader) => { const metric = statsById.get(trader.id); const isRanked = Boolean(metric?.verified && metric.return_pct !== null); const rank = isRanked ? verifiedRankedProfiles.findIndex((item) => item.id === trader.id) + 1 : null; return <tr key={trader.id}><td><span className={`rank-number ${rank && rank <= 3 ? "rank-top" : ""}`}>{rank ? String(rank).padStart(2, "0") : "—"}</span></td><td><div className="trader-cell"><span className="avatar">{initials(trader.display_name)}</span><span><strong>{trader.display_name}{trader.id === user?.id ? <em className="you-tag">YOU</em> : null}</strong><small>{trader.role === "admin" ? "Admin trader" : "Arena trader"}</small></span></div></td><td className={isRanked && Number(metric?.return_pct) >= 0 ? "positive" : isRanked ? "negative" : "muted-cell"}>{isRanked ? formatPercent(metric?.return_pct) : "—"}</td><td>{isRanked ? formatMoney(metric?.pnl) : "—"}</td><td>{isRanked && metric?.win_rate != null ? `${Number(metric.win_rate).toFixed(1)}%` : "—"}</td><td>{isRanked && metric?.completed_trades != null ? metric.completed_trades : "—"}</td><td>{isRanked ? <span className="status-badge status-verified"><Check size={12} /> Verified</span> : <span className="status-badge status-pending">Pending data</span>}</td></tr>; })}</tbody></table></div>}
          </section>}

          {pathname === "/traders" && <section className="panel"><div className="panel-heading traders-heading"><div><h2>All traders</h2><p>{profiles.length} registered {profiles.length === 1 ? "member" : "members"}</p></div><div className="search-box"><Search size={16} /><input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search traders…" aria-label="Search traders" /><SlidersHorizontal size={15} className="muted-icon" /></div></div>
            {filteredProfiles.length === 0 ? <div className="empty-state"><span className="empty-icon"><Search size={22} /></span><h3>No traders found</h3><p>Try another name or clear your search.</p><button className="button button-secondary button-small" onClick={() => setSearchQuery("")}>Clear search</button></div> : <div className="table-wrap"><table><thead><tr><th>TRADER</th><th>ROLE</th><th>MEMBER SINCE</th><th>PERFORMANCE</th></tr></thead><tbody>{[...filteredProfiles].sort((a, b) => a.display_name.localeCompare(b.display_name)).map((trader) => { const metric = statsById.get(trader.id); const verified = Boolean(metric?.verified && metric.return_pct !== null); return <tr key={trader.id}><td><div className="trader-cell"><span className="avatar">{initials(trader.display_name)}</span><span><strong>{trader.display_name}{trader.id === user?.id ? <em className="you-tag">YOU</em> : null}</strong><small>{trader.id === user?.id ? user.email : "Trading Arena member"}</small></span></div></td><td>{trader.role === "admin" ? <span className="role-label role-admin"><ShieldCheck size={13} /> Admin trader</span> : <span className="role-label">Trader</span>}</td><td>{formattedDate(trader.created_at)}</td><td>{verified ? <span className={Number(metric?.return_pct) >= 0 ? "positive" : "negative"}>{formatPercent(metric?.return_pct)} return</span> : <span className="muted-cell">No verified metrics</span>}</td></tr>; })}</tbody></table></div>}
          </section>}

          {pathname === "/account" && <section className="account-grid"><div className="panel account-panel"><div className="panel-heading"><div><h2>Profile details</h2><p>Keep your trader identity up to date.</p></div><UserRound size={18} className="muted-icon" /></div><form className="account-form" onSubmit={saveProfile}><div className="profile-hero"><span className="avatar avatar-xl">{initials(displayName || "Trader")}</span><div><strong>{profile?.display_name}</strong><span>{isAdmin ? "Administrator and trader" : "Trader account"}</span></div></div><label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required /></label><label>Email address<input value={user?.email ?? ""} readOnly disabled /><small>Your sign-in email is managed by the authentication provider.</small></label><label>Account role<input value={isAdmin ? "Administrator + Trader" : "Trader"} readOnly disabled /></label><div className="form-actions"><button type="submit" className="button button-primary" disabled={savingProfile || !displayName.trim()}>{savingProfile ? "Saving…" : "Save changes"}</button></div></form></div><div className="account-aside"><div className="panel account-summary"><div className="summary-icon"><ShieldCheck size={20} /></div><h3>Account security</h3><p>Your account is protected by Supabase authentication and database access policies.</p><div className="summary-line"><span>Account status</span><span className="status-badge status-verified"><Check size={12} /> Active</span></div><div className="summary-line"><span>Member since</span><strong>{formattedDate(profile?.created_at)}</strong></div><div className="summary-line"><span>Performance records</span><strong>{ownStats ? (ownStats.verified ? "Verified" : "Unverified") : "Not submitted"}</strong></div></div><div className="panel signout-panel"><div><h3>Sign out</h3><p>End this session on the current device.</p></div><button className="button button-secondary" onClick={handleSignOut}><LogOut size={16} /> Sign out</button></div></div></section>}

          {pathname === "/admin" && isAdmin && <section className="panel"><div className="panel-heading"><div><h2>Trader management</h2><p>Maintain performance metrics. Only verified records appear in rankings.</p></div><span className="count-pill">{profiles.length} accounts</span></div><div className="admin-notice"><ShieldCheck size={17} /><div><strong>Administrator access</strong><span>Metrics entered here are manual records. Mark a record verified only after validating its source.</span></div></div>
            <div className="table-wrap"><table><thead><tr><th>TRADER</th><th>RETURN</th><th>NET P&L</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{[...profiles].sort((a, b) => a.display_name.localeCompare(b.display_name)).map((trader) => { const metric = statsById.get(trader.id); const editing = editingId === trader.id; return <FragmentRow key={trader.id} trader={trader} metric={metric} editing={editing} draft={draft} onEdit={() => startEditing(trader)} onCancel={() => setEditingId(null)} onDraft={setDraft} onSubmit={saveTraderStats} saving={savingStats} />; })}</tbody></table></div>
          </section>}
          {pathname === "/admin" && isAdmin && <ChallengeSettings />}
          {pathname === "/admin" && isAdmin && <ChallengesView />}

          <footer className="app-footer"><span>© {new Date().getFullYear()} Trading Arena</span><span>Built for clarity. Designed for performance.</span></footer>
        </div>
      </main>
    </div>
  );
}

type FragmentRowProps = {
  trader: Profile;
  metric?: TraderStats;
  editing: boolean;
  draft: DraftStats;
  onEdit: () => void;
  onCancel: () => void;
  onDraft: (draft: DraftStats) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
};

function FragmentRow({ trader, metric, editing, draft, onEdit, onCancel, onDraft, onSubmit, saving }: FragmentRowProps) {
  return <>
    <tr><td><div className="trader-cell"><span className="avatar">{initials(trader.display_name)}</span><span><strong>{trader.display_name}</strong><small>{trader.role === "admin" ? "Admin trader" : "Arena trader"}</small></span></div></td><td>{metric?.verified && metric.return_pct !== null ? formatPercent(metric.return_pct) : "—"}</td><td>{metric?.verified ? formatMoney(metric.pnl) : "—"}</td><td>{metric?.verified ? <span className="status-badge status-verified"><Check size={12} /> Verified</span> : <span className="status-badge status-pending">Unverified</span>}</td><td><button className="button button-secondary button-small" onClick={onEdit}>{metric ? "Edit metrics" : "Add metrics"}</button></td></tr>
    {editing && <tr className="editor-row"><td colSpan={5}><form className="stats-editor" onSubmit={onSubmit}><div className="editor-title"><div><strong>Performance record</strong><span>{trader.display_name}</span></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel editing"><X size={16} /></button></div><div className="editor-fields"><label>Net P&L (₹)<input inputMode="decimal" value={draft.pnl} onChange={(e) => onDraft({ ...draft, pnl: e.target.value })} placeholder="e.g. 12500" /></label><label>Return (%)<input inputMode="decimal" value={draft.return_pct} onChange={(e) => onDraft({ ...draft, return_pct: e.target.value })} placeholder="e.g. 8.25" /></label><label>Win rate (%)<input inputMode="decimal" value={draft.win_rate} onChange={(e) => onDraft({ ...draft, win_rate: e.target.value })} placeholder="0–100" /></label><label>Completed trades<input inputMode="numeric" value={draft.completed_trades} onChange={(e) => onDraft({ ...draft, completed_trades: e.target.value })} placeholder="e.g. 42" /></label></div><label className="checkbox-line"><input type="checkbox" checked={draft.verified} onChange={(e) => onDraft({ ...draft, verified: e.target.checked })} /><span><strong>Mark as verified</strong><small>Verified metrics may affect leaderboard ranking.</small></span></label><div className="editor-actions"><button type="button" className="button button-secondary button-small" onClick={onCancel}>Cancel</button><button type="submit" className="button button-primary button-small" disabled={saving}>{saving ? "Saving…" : "Save record"}</button></div></form></td></tr>}
  </>;
}
