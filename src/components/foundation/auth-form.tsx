"use client";
import { useEffect, useState } from "react";
import { Effect } from "effect";
import { loginSchema, signupSchema, safeNext } from "../../lib/foundation/contracts";
export default function AuthForm({ signup = false }: { signup?: boolean }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "confirmation") {
      setError(true); setMessage("Email confirmation failed or expired. Please try the confirmation link again or sign in if already confirmed.");
    }
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    await Effect.runPromise(Effect.match(Effect.tryPromise({ try: async () => {
      const input = (signup ? signupSchema : loginSchema).safeParse({ email, password });
      if (!input.success) throw new Error(signup ? "Enter a valid email and a password of 12–128 characters." : "Enter a valid email and password.");
      const response = await fetch(`/api/auth/${signup ? "signup" : "signin"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Authentication failed.");
      return data;
    }, catch: (cause) => new Error(cause instanceof Error ? cause.message : "Could not reach the authentication service.") }), {
      onFailure: (cause) => { setError(true); setMessage(cause.message); },
      onSuccess: (result) => { setError(false); setMessage(result.message); setPassword(""); if (result.signedIn) window.location.assign(safeNext(new URLSearchParams(window.location.search).get("next"))); },
    }));
    setBusy(false);
  }
  return <main className="account-page"><a className="account-brand" href="/">CoCanvas<span>•</span></a><section className="account-card"><span className="eyebrow">ROOM FOR YOUR IDEAS</span><h1>{signup ? "Create your workspace." : "Welcome back."}</h1><p>{signup ? "Create an account to save and manage your boards." : "Sign in to pick up where you left off."}</p><form onSubmit={submit}>
    <label className="field">Email<input aria-label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
    <label className="field">Password<input aria-label="Password" type="password" required minLength={signup ? 12 : 1} maxLength={128} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
    {signup && <p className="account-help">Use 12–128 characters. Confirm your email before signing in.</p>}
    <button className="button primary" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
    {message && <p role={error ? "alert" : "status"}>{message}</p>}
  </form><p>{signup ? "Already have an account?" : "New to CoCanvas?"} <a href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create account"}</a></p><a className="account-help" href="/">Explore the local demo →</a></section></main>;
}
