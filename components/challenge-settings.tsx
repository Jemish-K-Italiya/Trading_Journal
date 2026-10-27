"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, Plus, Save, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Challenge = {
  id: string;
  name: string;
  initial_capital: number;
  daily_target_min_pct: number;
  daily_target_max_pct: number;
  starts_on: string;
  ends_on: string;
  expiry_day: number;
  market_holidays: { date: string; name: string }[];
  status: "draft" | "open" | "closed";
};

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const defaultHolidays = [
  "2026-10-02 Gandhi Jayanti",
  "2026-10-20 Dussehra",
  "2026-11-10 Diwali-Balipratipada",
  "2026-11-24 Guru Nanak Jayanti",
  "2026-12-25 Christmas",
].join("\n");

const blank = {
  name: "Trading Arena Challenge",
  initial_capital: "100000",
  daily_target_min_pct: "1",
  daily_target_max_pct: "2",
  starts_on: "",
  ends_on: "",
  expiry_day: "4",
  status: "draft" as "draft" | "open" | "closed",
  market_holidays: defaultHolidays,
};

export default function ChallengeSettings() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(preferredId?: string) {
    const { data, error: loadError } = await createClient().from("challenges")
      .select("id,name,initial_capital,daily_target_min_pct,daily_target_max_pct,starts_on,ends_on,expiry_day,market_holidays,status")
      .order("created_at", { ascending: false });
    if (loadError) throw loadError;
    const rows = (data ?? []) as Challenge[];
    setChallenges(rows);
    const id = preferredId ?? selectedId;
    const current = rows.find((item) => item.id === id) ?? rows[0];
    if (current) {
      setSelectedId(current.id);
      setForm({
        name: current.name,
        initial_capital: String(current.initial_capital),
        daily_target_min_pct: String(current.daily_target_min_pct),
        daily_target_max_pct: String(current.daily_target_max_pct),
        starts_on: current.starts_on,
        ends_on: current.ends_on,
        expiry_day: String(current.expiry_day),
        status: current.status,
        market_holidays: (current.market_holidays ?? []).map((h) => `${h.date} ${h.name}`).join("\n"),
      });
    } else {
      setSelectedId("");
      setForm({ ...blank, starts_on: new Date().toISOString().slice(0, 10), ends_on: "" });
    }
  }

  useEffect(() => {
    load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load challenges. Run supabase/journal-migration.sql first."))
      .finally(() => setLoading(false));
    // Initial load only; selection changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectChallenge(id: string) {
    const item = challenges.find((row) => row.id === id);
    setSelectedId(id); setError(""); setMessage("");
    if (!item) return;
    setForm({
      name: item.name,
      initial_capital: String(item.initial_capital),
      daily_target_min_pct: String(item.daily_target_min_pct),
      daily_target_max_pct: String(item.daily_target_max_pct),
      starts_on: item.starts_on,
      ends_on: item.ends_on,
      expiry_day: String(item.expiry_day),
      status: item.status,
      market_holidays: (item.market_holidays ?? []).map((h) => `${h.date} ${h.name}`).join("\n"),
    });
  }

  function startNew() {
    setSelectedId("");
    setForm({ ...blank, starts_on: new Date().toISOString().slice(0, 10), ends_on: "" });
    setError(""); setMessage("");
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setMessage("");
    const capital = Number(form.initial_capital);
    const minPct = Number(form.daily_target_min_pct);
    const maxPct = Number(form.daily_target_max_pct);
    if (!form.name.trim() || !Number.isFinite(capital) || capital <= 0 ||
        !Number.isFinite(minPct) || !Number.isFinite(maxPct) || minPct < 0 ||
        maxPct < minPct || !form.starts_on || !form.ends_on || form.ends_on < form.starts_on) {
      setError("Check the name, initial capital, target band, and dates. Upper target must be at least the lower target.");
      return;
    }
    const holidays = form.market_holidays.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      return match ? { date: match[1], name: match[2].trim() } : null;
    });
    if (holidays.some((holiday) => holiday === null)) {
      setError("Each holiday must use the format YYYY-MM-DD Holiday name.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), initial_capital: capital,
        daily_target_min_pct: minPct, daily_target_max_pct: maxPct,
        starts_on: form.starts_on, ends_on: form.ends_on,
        expiry_day: Number(form.expiry_day), status: form.status,
        market_holidays: holidays,
      };
      const query = selectedId
        ? createClient().from("challenges").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", selectedId)
        : createClient().from("challenges").insert(payload);
      const { data, error: saveError } = await query.select("id").single();
      if (saveError) throw saveError;
      const savedId = data?.id ?? selectedId;
      await load(savedId);
      setMessage(selectedId ? "Challenge updated." : "Challenge created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save challenge.");
    } finally { setSaving(false); }
  }

  return <section className="panel" style={{ marginTop: 20 }}>
    <div className="panel-heading">
      <div><h2>Challenge management</h2><p>Create and configure challenges using the supplied Trading Challenge template.</p></div>
      <CalendarDays size={18} className="muted-icon" />
    </div>
    <div className="admin-notice"><ShieldCheck size={17} /><div><strong>Daily target bands</strong><span>Target percentage is evaluated against each trader’s opening balance for that trading day. Weekends and configured market holidays are excluded from trading-day counts.</span></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {message && <div className="notice notice-success" role="status">{message}</div>}
    {loading ? <p className="muted-cell">Loading challenge settings…</p> : <>
      <div className="row" style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 18 }}>
        <label style={{ flex: "1 1 260px" }}>Existing challenge<select value={selectedId} onChange={(e) => selectChallenge(e.target.value)}><option value="">New challenge…</option>{challenges.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
        <button type="button" className="button button-secondary" onClick={startNew}><Plus size={15} /> New challenge</button>
      </div>
      <form className="stats-editor" onSubmit={save}>
        <div className="editor-fields">
          <label>Challenge name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required /></label>
          <label>Initial capital per trader (₹)<input type="number" min="1" step="0.01" value={form.initial_capital} onChange={(e) => setForm({ ...form, initial_capital: e.target.value })} required /></label>
          <label>Daily target lower band (%)<input type="number" min="0" step="0.1" value={form.daily_target_min_pct} onChange={(e) => setForm({ ...form, daily_target_min_pct: e.target.value })} required /></label>
          <label>Daily target upper band (%)<input type="number" min="0" step="0.1" value={form.daily_target_max_pct} onChange={(e) => setForm({ ...form, daily_target_max_pct: e.target.value })} required /></label>
          <label>Challenge starts<input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} required /></label>
          <label>Challenge ends<input type="date" min={form.starts_on || undefined} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} required /></label>
          <label>Weekly expiry day<select value={form.expiry_day} onChange={(e) => setForm({ ...form, expiry_day: e.target.value })}>{dayNames.map((day, i) => <option key={day} value={i + 1}>{day}</option>)}</select></label>
          <label>Challenge status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}><option value="draft">Draft</option><option value="open">Open for joining</option><option value="closed">Closed</option></select></label>
        </div>
        <label style={{ display: "block", marginTop: 16 }}>Market holidays <small className="muted-cell">One per line: YYYY-MM-DD Holiday name</small><textarea rows={5} value={form.market_holidays} onChange={(e) => setForm({ ...form, market_holidays: e.target.value })} placeholder={"2026-12-25 Christmas"} /></label>
        <div className="editor-actions"><button type="submit" className="button button-primary" disabled={saving}><Save size={15} /> {saving ? "Saving…" : selectedId ? "Update challenge" : "Create challenge"}</button></div>
      </form>
      <div className="table-wrap" style={{ marginTop: 20 }}><table><thead><tr><th>CHALLENGE</th><th>CAPITAL</th><th>DAILY BAND</th><th>DATES</th><th>STATUS</th></tr></thead><tbody>{challenges.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>₹{Number(item.initial_capital).toLocaleString("en-IN")}</td><td>{item.daily_target_min_pct}%–{item.daily_target_max_pct}%</td><td>{item.starts_on} – {item.ends_on}</td><td><span className="status-badge status-pending">{item.status}</span></td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
