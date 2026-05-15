"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { isAuthError, storeKey, clearKey } from "@/lib/auth";

type Phase = "checking" | "ready" | "login";

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.status()
      .then(() => setPhase("ready"))
      .catch((err) => {
        if (isAuthError(err)) setPhase("login");
        else setPhase("ready"); // network error etc — let the page handle it
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = inputKey.trim();
    if (!key) return;
    setBusy(true);
    setError("");
    storeKey(key);
    try {
      await api.status();
      setPhase("ready");
    } catch (err) {
      clearKey();
      if (isAuthError(err)) {
        setError("Invalid API key. Try again.");
      } else {
        setError("Connection failed. Check the URL and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Connecting…</p>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Colony</h1>
            <p className="text-sm text-muted-foreground">Enter the API key to access this colony.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              autoFocus
              placeholder="API key"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm
                         placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || !inputKey.trim()}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground
                         hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
