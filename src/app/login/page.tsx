"use client";
import { useState } from "react";
import { supabase, errMsg } from "@/lib/supabase";
import { Button, Field, Input, ErrorBox } from "@/components/ui";

export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "up") {
        if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setInfo("Account created. Check your email and tap the confirmation link, then sign in here.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/settings/` });
        if (error) throw error;
        setInfo("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto size-16 rounded-[20px] bg-surface-2 border border-line grid place-items-center mb-4">
            <span className="text-2xl font-bold text-accent">A</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-tight">AMAN <span className="text-accent">OS</span></h1>
          <p className="text-ink-3 text-sm mt-1">{mode === "in" ? "Sign in to continue" : mode === "up" ? "Create your account" : "Reset your password"}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode !== "reset" && (
            <Field label="Password"><Input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
          {error && <ErrorBox error={error} />}
          {info && <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm text-accent">{info}</div>}
          <Button size="lg" type="submit" loading={busy}>{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</Button>
        </form>
        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          {mode !== "in" && <button className="text-ink-2" onClick={() => setMode("in")}>Have an account? <span className="text-accent">Sign in</span></button>}
          {mode !== "up" && <button className="text-ink-2" onClick={() => setMode("up")}>New here? <span className="text-accent">Create account</span></button>}
          {mode === "in" && <button className="text-ink-3" onClick={() => setMode("reset")}>Forgot password?</button>}
        </div>
      </div>
    </div>
  );
}
