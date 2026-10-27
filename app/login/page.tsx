"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, BarChart3, LockKeyhole, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Account created. Check your email to confirm your address, then sign in.");
        } else {
          router.replace("/"); router.refresh();
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
        router.replace("/"); router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-layout">
      <section className="auth-brand-panel">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark"><BarChart3 size={21} strokeWidth={2.4} /></span>
          <span>TRADING<span className="brand-light">ARENA</span></span>
        </Link>
        <div className="auth-message">
          <div className="eyebrow"><span className="live-dot" /> BUILT FOR DISCIPLINED TRADERS</div>
          <h1>Performance.<br /><span>Without the noise.</span></h1>
          <p>A focused space to track trading performance, compare results, and grow alongside serious traders.</p>
          <div className="auth-benefits">
            <div><span className="benefit-icon"><BarChart3 size={17} /></span><span>Performance-led leaderboards</span></div>
            <div><span className="benefit-icon"><ShieldCheck size={17} /></span><span>Private accounts and controlled access</span></div>
            <div><span className="benefit-icon"><LockKeyhole size={17} /></span><span>No noisy social feed</span></div>
          </div>
        </div>
        <div className="auth-footer">A clearer view of trading performance.</div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="mobile-brand brand-lockup"><span className="brand-mark"><BarChart3 size={21} /></span><span>TRADING<span className="brand-light">ARENA</span></span></div>
          <div className="form-heading">
            <div className="eyebrow">YOUR TRADING WORKSPACE</div>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p>{mode === "login" ? "Sign in to continue to your dashboard." : "Join the arena. Your trader profile is created automatically."}</p>
          </div>
          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "signup" && <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Morgan" maxLength={60} autoComplete="name" required /></label>}
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
            {error && <div className="notice notice-error" role="alert">{error}</div>}
            {message && <div className="notice notice-success" role="status">{message}</div>}
            <button className="button button-primary button-full" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}<ArrowUpRight size={17} /></button>
          </form>
          <div className="auth-switch">{mode === "login" ? "New to Trading Arena?" : "Already have an account?"} <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
          <p className="auth-legal">By continuing, you agree to use the platform responsibly. Trading results are not investment advice.</p>
        </div>
      </section>
    </main>
  );
}
