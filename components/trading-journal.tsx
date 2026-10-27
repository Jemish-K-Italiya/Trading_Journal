"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, CirclePlus, Pencil, Save, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type DayLog = { id: string; user_id: string; trade_date: string; gross_pnl: number; charges: number; withdrawal: number; pnl_mode: "trades" | "manual"; notes: string | null; created_at: string };
type Trade = { id: string; user_id: string; trade_date: string; symbol: string; side: "LONG" | "SHORT"; quantity: number; entry_price: number; exit_price: number; gross_pnl: number; charges: number; notes: string | null; created_at: string };
type TradeDraft = { symbol: string; side: "LONG" | "SHORT"; quantity: string; entry_price: string; exit_price: string; gross_pnl: string; charges: string; notes: string };
const blankTrade: TradeDraft = { symbol: "", side: "LONG", quantity: "1", entry_price: "", exit_price: "", gross_pnl: "", charges: "0", notes: "" };
const today = () => new Date().toLocaleDateString("en-CA");
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));

export default function TradingJournal() {
  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(today());
  const [logs, setLogs] = useState<DayLog[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [gross, setGross] = useState("");
  const [charges, setCharges] = useState("0");
  const [withdrawal, setWithdrawal] = useState("0");
  const [pnlMode, setPnlMode] = useState<"trades" | "manual">("trades");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<TradeDraft>(blankTrade);
  const [editingTrade, setEditingTrade] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (uid?: string) => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const id = uid ?? auth.user?.id;
    if (!id) { setError("Please sign in to use your trading journal."); setLoading(false); return; }
    setUserId(id);
    const [{ data: dayRows, error: dayError }, { data: tradeRows, error: tradeError }] = await Promise.all([
      supabase.from("journal_days").select("id,user_id,trade_date,gross_pnl,charges,withdrawal,pnl_mode,notes,created_at").eq("user_id", id).order("trade_date", { ascending: false }).limit(180),
      supabase.from("journal_trades").select("id,user_id,trade_date,symbol,side,quantity,entry_price,exit_price,gross_pnl,charges,notes,created_at").eq("user_id", id).order("trade_date", { ascending: false }).limit(500),
    ]);
    if (dayError) throw dayError;
    if (tradeError) throw tradeError;
    setLogs((dayRows ?? []) as DayLog[]); setTrades((tradeRows ?? []) as Trade[]);
    const selected = (dayRows ?? []).find((row: DayLog) => row.trade_date === date);
    setGross(selected ? String(selected.gross_pnl) : ""); setCharges(selected ? String(selected.charges) : "0"); setWithdrawal(selected ? String(selected.withdrawal ?? 0) : "0"); setPnlMode(selected?.pnl_mode ?? "trades"); setNotes(selected?.notes ?? "");
  }, [date]);

  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load journal." )).finally(() => setLoading(false)); }, [load]);

  const dayTrades = useMemo(() => trades.filter((trade) => trade.trade_date === date), [trades, date]);
  const tradeGross = useMemo(() => dayTrades.reduce((sum, trade) => sum + Number(trade.gross_pnl), 0), [dayTrades]);
  const tradeCharges = useMemo(() => dayTrades.reduce((sum, trade) => sum + Number(trade.charges), 0), [dayTrades]);
  const dailyGross = pnlMode === "trades" ? tradeGross : (Number(gross) || 0);
  const dailyCharges = pnlMode === "trades" ? tradeCharges : (Number(charges) || 0);
  const net = dailyGross - dailyCharges;
  const dailyNet = tradeGross - tradeCharges;

  async function saveDay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(""); setSuccess("");
    const grossNum = pnlMode === "manual" ? Number(gross) : 0, chargesNum = pnlMode === "manual" ? Number(charges) : 0, withdrawalNum = Number(withdrawal || 0);
    if (!Number.isFinite(grossNum) || !Number.isFinite(chargesNum) || chargesNum < 0 || !Number.isFinite(withdrawalNum) || withdrawalNum < 0) { setError("Enter valid P&L, non-negative charges, and non-negative withdrawal."); setSaving(false); return; }
    try {
      const supabase = createClient();
      const { error: saveError } = await supabase.from("journal_days").upsert({ user_id: userId, trade_date: date, gross_pnl: grossNum, charges: chargesNum, withdrawal: withdrawalNum, pnl_mode: pnlMode, notes: notes.trim() || null }, { onConflict: "user_id,trade_date" });
      if (saveError) throw saveError;
      setSuccess(pnlMode === "trades" ? "Daily journal settings saved. P&L is calculated from individual trades." : "Manual daily P&L saved."); await load(userId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save daily summary."); }
    finally { setSaving(false); }
  }

  async function saveTrade(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError(""); setSuccess("");
    const quantity = Number(draft.quantity), entry = Number(draft.entry_price), exit = Number(draft.exit_price), grossPnl = Number(draft.gross_pnl), fee = Number(draft.charges);
    if (!draft.symbol.trim() || ![quantity, entry, exit, grossPnl, fee].every(Number.isFinite) || quantity <= 0 || entry < 0 || exit < 0 || fee < 0) { setError("Check the trade fields. Quantity must be positive; prices and charges cannot be negative."); setSaving(false); return; }
    const payload = { user_id: userId, trade_date: date, symbol: draft.symbol.trim().toUpperCase(), side: draft.side, quantity, entry_price: entry, exit_price: exit, gross_pnl: grossPnl, charges: fee, notes: draft.notes.trim() || null };
    try {
      const supabase = createClient();
      const query = editingTrade ? supabase.from("journal_trades").update(payload).eq("id", editingTrade).eq("user_id", userId) : supabase.from("journal_trades").insert(payload);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setDraft(blankTrade); setEditingTrade(null); setSuccess(editingTrade ? "Trade updated." : "Trade added."); await load(userId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save trade."); }
    finally { setSaving(false); }
  }

  function editTrade(trade: Trade) {
    setEditingTrade(trade.id); setDraft({ symbol: trade.symbol, side: trade.side, quantity: String(trade.quantity), entry_price: String(trade.entry_price), exit_price: String(trade.exit_price), gross_pnl: String(trade.gross_pnl), charges: String(trade.charges), notes: trade.notes ?? "" });
  }

  async function deleteTrade(id: string) {
    if (!window.confirm("Delete this trade record? This cannot be undone.")) return;
    setError(""); setSuccess("");
    const { error: deleteError } = await createClient().from("journal_trades").delete().eq("id", id).eq("user_id", userId);
    if (deleteError) setError(deleteError.message); else { setSuccess("Trade deleted."); await load(userId); }
  }

  async function changeDate(nextDate: string) {
    setDate(nextDate); setError(""); setSuccess("");
    const day = logs.find((row) => row.trade_date === nextDate);
    setGross(day ? String(day.gross_pnl) : ""); setCharges(day ? String(day.charges) : "0"); setWithdrawal(day ? String(day.withdrawal ?? 0) : "0"); setPnlMode(day?.pnl_mode ?? "trades"); setNotes(day?.notes ?? ""); setDraft(blankTrade); setEditingTrade(null);
  }

  if (loading) return <section className="panel journal-loading">Loading your trading journal…</section>;

  return <div className="journal-layout">
    {error && <div className="notice notice-error journal-notice">{error}<button className="notice-close" onClick={() => setError("")} aria-label="Dismiss error"><X size={15}/></button></div>}
    {success && <div className="notice notice-success journal-notice">{success}<button className="notice-close" onClick={() => setSuccess("")} aria-label="Dismiss message"><X size={15}/></button></div>}
    <section className="metric-grid journal-metrics">
      <div className="metric-card"><div className="metric-top"><span>Daily gross P&amp;L</span><span className="metric-icon"><BookOpen size={17}/></span></div><div className={`metric-value ${dailyGross > 0 ? "positive" : dailyGross < 0 ? "negative" : ""}`}>{money(dailyGross)}</div><div className="metric-foot"><span className="metric-neutral">{pnlMode === "trades" ? "Summed from trade ledger" : "Manual daily entry"}</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>Charges</span><span className="metric-icon"><CalendarDays size={17}/></span></div><div className="metric-value">{money(dailyCharges)}</div><div className="metric-foot"><span className="metric-neutral">{pnlMode === "trades" ? "Summed from trade ledger" : "Manual daily entry"}</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>Daily net P&amp;L</span><span className="metric-icon"><Save size={17}/></span></div><div className={`metric-value ${net > 0 ? "positive" : net < 0 ? "negative" : ""}`}>{money(net)}</div><div className="metric-foot"><span className="metric-neutral">Charges subtracted once</span></div></div>
      <div className="metric-card"><div className="metric-top"><span>Trades logged</span><span className="metric-icon"><CirclePlus size={17}/></span></div><div className="metric-value">{dayTrades.length}</div><div className="metric-foot"><span className="metric-neutral">Individual trade records</span></div></div>
    </section>
    <section className="panel journal-panel"><div className="panel-heading"><div><h2>Daily trading log</h2><p>Record your day-level P&amp;L, charges, and review notes.</p></div><label className="journal-date">Trade date<input type="date" value={date} max={today()} onChange={(e) => void changeDate(e.target.value)} /></label></div>
      <form className="journal-form" onSubmit={saveDay}><div className="journal-form-grid"><label>P&amp;L source<select value={pnlMode} onChange={(e) => setPnlMode(e.target.value as "trades" | "manual")}><option value="trades">Trade ledger (recommended)</option><option value="manual">Manual daily entry</option></select></label>{pnlMode === "manual" ? <><label>Gross P&amp;L (₹)<input type="number" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="e.g. 2500.00" required /></label><label>Total charges (₹)<input type="number" step="0.01" min="0" value={charges} onChange={(e) => setCharges(e.target.value)} required /></label></> : <div className="notice notice-success journal-notice"><strong>Automatic mode:</strong> daily gross P&amp;L and charges are calculated from the individual trades logged for this date. Daily figures are not added again.</div>}<label>Withdrawal (₹)<input type="number" step="0.01" min="0" value={withdrawal} onChange={(e) => setWithdrawal(e.target.value)} placeholder="0.00" /></label><label className="journal-notes-field">Daily notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Setup quality, execution, mistakes, lessons learned…" maxLength={4000}/></label></div><div className="journal-actions"><span className="muted-cell">Net P&amp;L: <strong className={net > 0 ? "positive" : net < 0 ? "negative" : ""}>{money(net)}</strong>{pnlMode === "trades" ? " · calculated from individual trades" : " · manual daily total"}</span><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save daily log"}</button></div></form>
    </section>
    <section className="panel journal-panel"><div className="panel-heading"><div><h2>{editingTrade ? "Edit trade" : "Add individual trade"}</h2><p>Log each position with execution details and transaction costs.</p></div><span className="count-pill">{dayTrades.length} trades · {date}</span></div>
      <form className="journal-form" onSubmit={saveTrade}><div className="journal-trade-fields"><label>Symbol / instrument<input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="e.g. NIFTY 24500 CE" maxLength={80} required /></label><label>Side<select value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as "LONG" | "SHORT" })}><option value="LONG">Long</option><option value="SHORT">Short</option></select></label><label>Quantity<input type="number" min="1" step="1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} required /></label><label>Entry price (₹)<input type="number" min="0" step="0.01" value={draft.entry_price} onChange={(e) => setDraft({ ...draft, entry_price: e.target.value })} required /></label><label>Exit price (₹)<input type="number" min="0" step="0.01" value={draft.exit_price} onChange={(e) => setDraft({ ...draft, exit_price: e.target.value })} required /></label><label>Gross P&amp;L (₹)<input type="number" step="0.01" value={draft.gross_pnl} onChange={(e) => setDraft({ ...draft, gross_pnl: e.target.value })} required /></label><label>Charges (₹)<input type="number" min="0" step="0.01" value={draft.charges} onChange={(e) => setDraft({ ...draft, charges: e.target.value })} required /></label><label>Trade notes<input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Setup / reason / lesson" maxLength={2000}/></label></div><div className="journal-actions"><span className="muted-cell">Trade net P&amp;L: <strong className={(Number(draft.gross_pnl) - Number(draft.charges)) > 0 ? "positive" : (Number(draft.gross_pnl) - Number(draft.charges)) < 0 ? "negative" : ""}>{money((Number(draft.gross_pnl) || 0) - (Number(draft.charges) || 0))}</strong></span><div className="journal-button-group">{editingTrade && <button type="button" className="button button-secondary" onClick={() => { setEditingTrade(null); setDraft(blankTrade); }}>Cancel edit</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editingTrade ? "Update trade" : "Add trade"}</button></div></div></form>
      <div className="table-wrap"><table><thead><tr><th>INSTRUMENT</th><th>SIDE</th><th>QTY</th><th>ENTRY</th><th>EXIT</th><th>GROSS P&amp;L</th><th>CHARGES</th><th>NET P&amp;L</th><th>NOTES</th><th>ACTIONS</th></tr></thead><tbody>{dayTrades.length === 0 ? <tr><td colSpan={10}><div className="journal-empty">No trades logged for this date yet.</div></td></tr> : dayTrades.map((trade) => { const tradeNet = Number(trade.gross_pnl) - Number(trade.charges); return <tr key={trade.id}><td><strong>{trade.symbol}</strong></td><td><span className="role-label">{trade.side}</span></td><td>{trade.quantity}</td><td>{money(Number(trade.entry_price))}</td><td>{money(Number(trade.exit_price))}</td><td className={Number(trade.gross_pnl) >= 0 ? "positive" : "negative"}>{money(Number(trade.gross_pnl))}</td><td>{money(Number(trade.charges))}</td><td className={tradeNet >= 0 ? "positive" : "negative"}>{money(tradeNet)}</td><td className="journal-note-cell" title={trade.notes ?? ""}>{trade.notes || "—"}</td><td><div className="journal-row-actions"><button className="icon-button" title="Edit trade" aria-label="Edit trade" onClick={() => editTrade(trade)}><Pencil size={14}/></button><button className="icon-button danger-icon" title="Delete trade" aria-label="Delete trade" onClick={() => void deleteTrade(trade.id)}><Trash2 size={14}/></button></div></td></tr>; })}</tbody></table></div>
      {dayTrades.length > 0 && <div className="journal-total"><span>Individual trades net total</span><strong className={dailyNet >= 0 ? "positive" : "negative"}>{money(dailyNet)}</strong><small>{pnlMode === "trades" ? "The daily summary uses this trade-ledger total. It is not added to the trades a second time." : "Manual daily mode is authoritative for the daily total; individual trades are retained for reference and are not added again."}</small></div>}
    </section>
    <div className="footnote"><BookOpen size={15}/><span>Your journal is private to your account. Trade ledger is the default source of truth; manual daily mode is an alternative. Only the selected source contributes to daily P&L, so totals are not double-counted. Figures are manually entered and are not broker-synced.</span></div>
  </div>;
}
