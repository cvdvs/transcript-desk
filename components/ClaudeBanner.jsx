"use client";

// Shows when the Claude sign-in has lapsed (AI summaries paused), with a
// button that opens the login in Terminal on the Mac.

import { useCallback, useEffect, useState } from "react";

export default function ClaudeBanner() {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/claude");
      setStatus(await res.json());
    } catch {
      /* server restarting */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (action === "login") {
        setMsg(
          res.ok
            ? "Terminal opened on the Mac mini. Sign in there, then press check again."
            : data.error || "Couldn't open Terminal."
        );
      } else {
        setStatus(data);
        if (!data.ok) setMsg("Still signed out. Finish the sign-in in Terminal, then try again.");
      }
    } catch {
      setMsg("Couldn't reach the app.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (status.ok && status.backfilling) {
    return (
      <div className="claude-banner calm">
        <div className="claude-banner-text">
          <div className="status-title">signed back in</div>
          <div className="status-sub">Catching up on summaries that were missed while signed out.</div>
        </div>
      </div>
    );
  }

  if (status.ok) return null;

  return (
    <div className="claude-banner">
      <div className="claude-banner-text">
        <div className="status-title">claude is signed out</div>
        <div className="status-sub">
          AI summaries, research packs, translation and book extraction are paused. Capturing and
          transcribing still work, and missed summaries fill in automatically once you sign back in.
        </div>
        {msg && <div className="status-sub" style={{ color: "var(--ink)", marginTop: 6 }}>{msg}</div>}
      </div>
      <div className="claude-banner-actions">
        <button className="btn btn-primary" onClick={() => act("login")} disabled={busy}>
          sign in
        </button>
        <button className="btn" onClick={() => act("check")} disabled={busy}>
          {busy ? "checking…" : "check again"}
        </button>
      </div>
    </div>
  );
}
