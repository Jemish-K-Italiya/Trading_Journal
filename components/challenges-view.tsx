"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, CirclePlus, Flag, ShieldCheck, Trophy, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Challenge = {
  id: string; name: string; initial_capital: number; daily_target_min_pct: number; daily_target_max_pct: number;
  starts_on: string; ends_on: string; expiry_day: number; market_holidays: { date: string; name: string }[];
  status: "draft" | "open" | "closed"; created_by: string | null;
};
type Member = { challenge_id: string; user_id: string; joined_at: string; display_name?: string };
type DailyResult = {
  challenge_id: string; user_id: string; display_name: string; trade_date: string; initial_capital: number;
  daily_target_min_pct: number; daily_target_max_pct: number; gross_pnl: number; charges: number; withdrawal: number; pnl_mode: "trades" | "manual";
};
type Standing = { user_id: string; display_name: string; balance: number; net: number; return_pct: number; days: number; win_rate: number; band_hit_rate: number; streak: number; max_drawdown: number };
const weekdays = [{ value: 1, label: "Monday" }, { value: 2, label: "Tuesday" }, { value: 3, label: "Wednesday" }, { value: 4, label: "Thursday" }, { value: 5, label: "Friday" }];
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const percent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const dateToday = () => new Date().toLocaleDateString("en-CA");
const defaultEndDate = () => {
  // One year ahead; setFullYear on Feb 29 would overflow into March, so clamp to Feb 28.
  const d = new Date();
  const month = d.getMonth();
  d.setFullYear(d.getFullYear() + 1);
  if (d.getMonth() !== month) d.setDate(0);
  return d.toLocaleDateString("en-CA");
};

const fmtDate = (iso: string, withYear = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
};
const fmtRange = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4) ? `${fmtDate(a, false)} – ${fmtDate(b)}` : `${fmtDate(a)} – ${fmtDate(b)}`;
const windowLabel = (start: string, end: string) => {
  const today = dateToday();
  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  if (today < start) { const n = days(today, start); return `Starts in ${n} day${n === 1 ? "" : "s"}`; }
  if (today > end) return "Ended";
  const n = days(today, end); return n === 0 ? "Last day" : `${n} day${n === 1 ? "" : "s"} left`;
};

function makeStandings(members: Member[], rows: DailyResult[], defaultCapital = 0): Standing[] {
  const byUser = new Map<string, DailyResult[]>();
  rows.forEach((row) => byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]));
  return members.map((member) => {
    const days = (byUser.get(member.user_id) ?? []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    const initial = Number(days[0]?.initial_capital ?? rows[0]?.initial_capital ?? defaultCapital);
    let balance = initial, withdrawn = 0, peak = initial, maxDrawdown = 0, streak = 0, currentStreak = 0;
    let netTotal = 0, wins = 0, bandHits = 0;
    for (const day of days) {
      const gross = Number(day.gross_pnl || 0), charges = Number(day.charges || 0), withdrawal = Number(day.withdrawal || 0);
      const net = gross - charges;
      const open = balance;
      const pct = open > 0 ? net / open * 100 : 0;
      netTotal += net; balance += net - withdrawal; withdrawn += withdrawal;
      if (net > 0) { wins++; currentStreak++; streak = Math.max(streak, currentStreak); } else currentStreak = 0;
      if (pct >= Number(day.daily_target_min_pct) && pct <= Number(day.daily_target_max_pct)) bandHits++;
      const equity = balance + withdrawn; peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak * 100);
    }
    const profileName = days[0]?.display_name;
    return { user_id: member.user_id, display_name: profileName || member.display_name || `Trader ${member.user_id.slice(0, 6)}`, balance: balance || initial, net: netTotal,
      return_pct: initial > 0 ? (balance + withdrawn - initial) / initial * 100 : 0, days: days.length,
      win_rate: days.length ? wins / days.length * 100 : 0, band_hit_rate: days.length ? bandHits / days.length * 100 : 0,
      streak, max_drawdown: maxDrawdown };
  }).sort((a, b) => b.return_pct - a.return_pct);
}

export default function ChallengesView() {
  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<DailyResult[]>([]);
  const [selectedId, setSelectedId] = useState("");
  // Keep the latest selection in a ref so load() stays stable and does not refetch itself in a loop.
  const selectedIdRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [name, setName] = useState("Trading Challenge");
  const [capital, setCapital] = useState("100000");
  const [minPct, setMinPct] = useState("1");
  const [maxPct, setMaxPct] = useState("2");
  const [start, setStart] = useState(dateToday);
  const [end, setEnd] = useState(defaultEndDate);
  const [expiry, setExpiry] = useState("4");
  const [holidays, setHolidays] = useState("");

  const load = useCallback(async (preferredId?: string) => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Please sign in to view challenges."); setLoading(false); return; }
    setUserId(auth.user.id);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    setIsAdmin(profile?.role === "admin");
    const [{ data: challengeRows, error: challengeError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase.from("challenges").select("*").order("created_at", { ascending: false }),
      supabase.from("challenge_members").select("challenge_id,user_id,joined_at"),
    ]);
    if (challengeError) throw challengeError;
    if (memberError) throw memberError;
    const loadedChallenges = (challengeRows ?? []) as Challenge[];
    const baseMembers = (memberRows ?? []) as Member[];
    const memberIds = [...new Set(baseMembers.map((member) => member.user_id))];
    let profileNames: Record<string, string> = {};
    if (memberIds.length) {
      const { data: profileRows } = await supabase.from("profiles").select("id,display_name").in("id", memberIds);
      profileNames = Object.fromEntries((profileRows ?? []).map((row: { id: string; display_name: string }) => [row.id, row.display_name]));
    }
    const loadedMembers = baseMembers.map((member) => ({ ...member, display_name: profileNames[member.user_id] }));
    setChallenges(loadedChallenges); setMembers(loadedMembers);
    const nextId = preferredId && loadedChallenges.some((c) => c.id === preferredId) ? preferredId : (selectedIdRef.current && loadedChallenges.some((c) => c.id === selectedIdRef.current) ? selectedIdRef.current : loadedChallenges[0]?.id ?? "");
    selectedIdRef.current = nextId; setSelectedId(nextId);
    if (nextId) {
      const { data: dailyRows, error: resultError } = await supabase.rpc("get_challenge_daily_results", { p_challenge_id: nextId });
      if (resultError) throw resultError;
      setRows((dailyRows ?? []) as DailyResult[]);
    } else setRows([]);
    setLoading(false);
  }, []);

  useEffect(() => { load().catch((caught) => { setError(caught instanceof Error ? caught.message : "Unable to load challenges."); setLoading(false); }); }, [load]);

  const selected = challenges.find((challenge) => challenge.id === selectedId) ?? null;
  const selectedMembers = useMemo(() => members.filter((member) => member.challenge_id === selectedId), [members, selectedId]);
  const standings = useMemo(() => makeStandings(selectedMembers, rows, Number(selected?.initial_capital ?? 0)), [selectedMembers, rows, selected]);
  const joined = selectedMembers.some((member) => member.user_id === userId);

  async function selectChallenge(id: string) {
    selectedIdRef.current = id; setSelectedId(id); setError("");
    try {
      const { data, error: rpcError } = await createClient().rpc("get_challenge_daily_results", { p_challenge_id: id });
      if (rpcError) throw rpcError;
      setRows((data ?? []) as DailyResult[]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load challenge standings."); }
  }

  async function createChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    const cap = Number(capital), min = Number(minPct), max = Number(maxPct);
    if (!name.trim() || !(cap > 0) || min < 0 || max < min || !start || !end || end < start) { setError("Check the challenge name, capital, target bands, and dates."); setSaving(false); return; }
    const holidayRows = holidays.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      return match ? { date: match[1], name: match[2] } : null;
    });
    if (holidayRows.some((row) => row === null)) { setError("Enter holidays one per line using YYYY-MM-DD Holiday name."); setSaving(false); return; }
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Please sign in again.");
      const { data, error: saveError } = await supabase.from("challenges").insert({
        name: name.trim(), initial_capital: cap, daily_target_min_pct: min, daily_target_max_pct: max,
        starts_on: start, ends_on: end, expiry_day: Number(expiry), market_holidays: holidayRows, status: "open", created_by: auth.user.id,
      }).select("id").single();
      if (saveError) throw saveError;
      setSuccess("Challenge created. Traders can now join it.");
      await load(data.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create challenge."); }
    finally { setSaving(false); }
  }

  async function joinChallenge() {
    if (!selected) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const { error: joinError } = await createClient().from("challenge_members").insert({ challenge_id: selected.id, user_id: userId });
      if (joinError) throw joinError;
      setSuccess("You joined the challenge. Log your days in Journal to update your standing.");
      await load(selected.id);
    } catch (caught) { setError(caught instanceof Error && caught.message.includes("duplicate") ? "You have already joined this challenge." : caught instanceof Error ? caught.message : "Unable to join challenge."); }
    finally { setSaving(false); }
  }

  async function updateStatus(challenge: Challenge, status: Challenge["status"]) {
    setError(""); setSuccess("");
    const { error: updateError } = await createClient().from("challenges").update({ status }).eq("id", challenge.id);
    if (updateError) setError(updateError.message); else { setSuccess(`Challenge marked ${status}.`); await load(challenge.id); }
  }

  if (loading) return <section className="panel"><p className="muted-cell">Loading challenges…</p></section>;

  return <div className="journal-layout">
    {error && <div className="notice notice-error journal-notice">{error}</div>}
    {success && <div className="notice notice-success journal-notice">{success}</div>}

    {isAdmin && <section className="panel journal-panel">
      <div className="panel-heading"><div><h2><CirclePlus size={17} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8 }}/>Create a trading challenge</h2><p>Set the capital base, daily target band, challenge window, and market calendar.</p></div><span className="role-label role-admin"><ShieldCheck size={13}/> Admin only</span></div>
      <form className="journal-form" onSubmit={createChallenge}>
        <div className="journal-form-grid">
          <label>Challenge name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required placeholder="e.g. November Consistency Challenge"/></label>
          <label>Initial capital per trader (₹)<input type="number" min="1" step="0.01" value={capital} onChange={(e) => setCapital(e.target.value)} required/></label>
          <label>Daily target lower band (%)<input type="number" min="0" step="0.1" value={minPct} onChange={(e) => setMinPct(e.target.value)} required/></label>
          <label>Daily target upper band (%)<input type="number" min="0" step="0.1" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} required/></label>
          <label>Challenge start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} required/></label>
          <label>Challenge end date<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} min={start} required/></label>
          <label>Weekly expiry day<select value={expiry} onChange={(e) => setExpiry(e.target.value)}>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
          <label className="journal-notes-field">Market holidays (one per line)<textarea rows={4} value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder="2026-12-25 Christmas\n2027-01-26 Republic Day"/></label>
        </div>
        <div className="journal-actions"><span className="muted-cell">Target band is measured against each day&apos;s opening balance.</span><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create challenge"}</button></div>
      </form>
    </section>}

    <section className="panel journal-panel">
      <div className="panel-heading"><div><h2><Flag size={17} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8 }}/>Challenges</h2><p>Join a challenge and use Journal to record daily performance. Daily target is measured against the morning balance.</p></div><span className="count-pill">{challenges.length} total</span></div>
      {challenges.length === 0 ? <div className="empty-state"><span className="empty-icon"><CalendarDays size={22}/></span><h3>No challenges yet</h3><p>An administrator can create the first challenge using the form above.</p></div> : <>
        <div className="journal-form-grid challenge-select-grid"><label>Select challenge<select value={selectedId} onChange={(e) => void selectChallenge(e.target.value)}>{challenges.map((challenge) => <option key={challenge.id} value={challenge.id}>{challenge.name} · {challenge.status}</option>)}</select></label>{selected && <div className="challenge-status-line"><span className={`status-badge ${selected.status === "open" ? "status-verified" : "status-pending"}`}>{selected.status === "open" ? <Check size={12}/> : <Flag size={12}/>} {selected.status}</span>{isAdmin && <label>Update status<select value={selected.status} onChange={(e) => void updateStatus(selected, e.target.value as Challenge["status"])}><option value="draft">Draft</option><option value="open">Open for joining</option><option value="closed">Closed</option></select></label>}</div>}</div>
        {selected && <>
          <div className="metric-grid journal-metrics challenge-metrics">
            <div className="metric-card"><div className="metric-top"><span>Initial capital</span><span className="metric-icon"><CirclePlus size={17}/></span></div><div className="metric-value">{money(Number(selected.initial_capital))}</div><div className="metric-foot"><span className="metric-neutral">Per trader</span></div></div>
            <div className="metric-card"><div className="metric-top"><span>Daily target band</span><span className="metric-icon"><Trophy size={17}/></span></div><div className="metric-value">{Number(selected.daily_target_min_pct).toFixed(1)}–{Number(selected.daily_target_max_pct).toFixed(1)}%</div><div className="metric-foot"><span className="metric-neutral">Of opening balance</span></div>{(() => { const lo = Number(selected.daily_target_min_pct), hi = Number(selected.daily_target_max_pct), scale = Math.max(hi * 1.5, hi + 1); return <div className="band-meter" aria-hidden="true"><span style={{ left: `${lo / scale * 100}%`, width: `${Math.max((hi - lo) / scale * 100, 3)}%` }}/></div>; })()}</div>
            <div className="metric-card"><div className="metric-top"><span>Challenge period</span><span className="metric-icon"><CalendarDays size={17}/></span></div><div className="metric-value challenge-period">{fmtRange(selected.starts_on, selected.ends_on)}</div><div className="metric-foot"><span className="metric-neutral">Expiry: {weekdays.find((d) => d.value === Number(selected.expiry_day))?.label ?? "—"}</span><span className="positive">{windowLabel(selected.starts_on, selected.ends_on)}</span></div></div>
            <div className="metric-card"><div className="metric-top"><span>Participants</span><span className="metric-icon"><Users size={17}/></span></div><div className="metric-value">{selectedMembers.length}</div><div className="metric-foot"><span className="metric-neutral">Registered traders</span></div></div>
          </div>
          {selected.status === "open" && !joined && <div className="journal-actions challenge-join"><span className="muted-cell">Your results use the source-of-truth mode selected in your journal.</span><button className="button button-primary" onClick={() => void joinChallenge()} disabled={saving}>Join challenge</button></div>}
          {joined && <div className="notice notice-success"><Check size={15} style={{ display: "inline", verticalAlign: "-3px", marginRight: 6 }}/>You are participating. <a href="/journal">Open your journal</a> to log performance for dates inside this challenge.</div>}
          {selected.market_holidays?.length > 0 && <div className="challenge-holidays"><strong>Market holidays</strong><ul>{selected.market_holidays.map((h) => <li key={`${h.date}-${h.name}`}><time dateTime={h.date}>{fmtDate(h.date, false)}</time>{h.name}</li>)}</ul></div>}
          <div className="panel-heading challenge-table-heading"><div><h2>Challenge standings</h2><p>Only logged days are included in day-based ratios. Daily notes and individual trade details remain private.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>RANK</th><th>TRADER</th><th>BALANCE</th><th>NET P&amp;L</th><th>RETURN</th><th>LOGGED DAYS</th><th>WIN RATE</th><th>BAND HIT</th><th>GREEN STREAK</th><th>MAX DD</th></tr></thead><tbody>{standings.length === 0 ? <tr><td colSpan={10}><div className="journal-empty">No participants yet. Join to be the first.</div></td></tr> : standings.map((standing, index) => <tr key={standing.user_id}><td><span className={`rank-number ${index < 3 ? "rank-top" : ""}`}>{String(index + 1).padStart(2, "0")}</span></td><td><strong>{standing.display_name}{standing.user_id === userId ? " (you)" : ""}</strong></td><td>{money(standing.balance)}</td><td className={standing.net >= 0 ? "positive" : "negative"}>{money(standing.net)}</td><td className={standing.return_pct >= 0 ? "positive" : "negative"}>{percent(standing.return_pct)}</td><td>{standing.days}</td><td>{standing.days ? `${standing.win_rate.toFixed(0)}%` : "—"}</td><td>{standing.days ? `${standing.band_hit_rate.toFixed(0)}%` : "—"}</td><td>{standing.streak}</td><td>{standing.days ? `${standing.max_drawdown.toFixed(2)}%` : "—"}</td></tr>)}</tbody></table></div>
        </>}
      </>}
    </section>
  </div>;
}
