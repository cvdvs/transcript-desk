"use client";

// Settings: folders, screenshots, storage and the Markdown mirror, the
// Claude sign-in, and display preferences for this device.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

function mb(bytes) {
  if (!bytes) return "0 MB";
  const v = bytes / 1024 / 1024;
  return v < 0.1 ? "< 0.1 MB" : `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function FolderRow({ name, count, names, onDone, flash }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  async function save() {
    const to = value.trim();
    setEditing(false);
    if (!to || to === name) return setValue(name);
    if (names.includes(to) && !confirm(`"${to}" already exists. Merge "${name}" into it?`)) return setValue(name);
    try {
      await post("/api/folders", { action: "rename", from: name, to });
      flash(names.includes(to) ? `merged into ${to}` : `renamed to ${to}`);
      onDone();
    } catch (e) {
      flash(e.message);
    }
  }

  async function remove() {
    if (!confirm(`Remove the folder "${name}"? Its ${count} note${count === 1 ? "" : "s"} stay — they just become unsorted.`)) return;
    try {
      await post("/api/folders", { action: "remove", name });
      flash(`removed ${name}`);
      onDone();
    } catch (e) {
      flash(e.message);
    }
  }

  return (
    <div className="set-row">
      {editing ? (
        <input
          className="folder-input set-grow"
          value={value}
          autoFocus
          maxLength={40}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setEditing(false);
              setValue(name);
            }
          }}
        />
      ) : (
        <span className="set-grow set-name">{name}</span>
      )}
      <span className="set-count">{count}</span>
      {editing ? (
        <button className="chip" onClick={save}>save</button>
      ) : (
        <>
          <button className="chip" onClick={() => setEditing(true)}>rename</button>
          <button className="chip chip-danger" onClick={remove}>remove</button>
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState(null);
  const [claude, setClaude] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [theme, setTheme] = useState("system");

  const load = useCallback(async () => {
    try {
      setData(await (await fetch("/api/settings")).json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/claude")
      .then((r) => r.json())
      .then(setClaude)
      .catch(() => {});
    try {
      setTheme(localStorage.getItem("td-theme") || "system");
    } catch {
      /* storage blocked */
    }
  }, [load]);

  function flash(text) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2600);
  }

  async function act(key, fn) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      flash(e.message);
    } finally {
      setBusy(null);
    }
  }

  function applyTheme(t) {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("td-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("td-theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {
      /* storage blocked */
    }
  }

  const names = data?.folders.map(([n]) => n) || [];

  return (
    <main className="settings">
      <div className="micro" style={{ margin: "34px 0 26px" }}>
        <Link href="/">← library</Link>
      </div>
      <h1 className="settings-title">Settings</h1>
      {msg && <div className="notice-box" style={{ marginBottom: 20 }}>{msg}</div>}

      {!data ? (
        <div className="panel"><div className="panel-body micro">loading…</div></div>
      ) : (
        <>
          <section className="panel set-panel">
            <div className="panel-head">
              folders <span>{names.length} folders · {data.unsorted} unsorted</span>
            </div>
            <div className="set-body">
              {names.length === 0 && <div className="set-hint">No folders yet. File a note from its page to start one.</div>}
              {data.folders.map(([name, count]) => (
                <FolderRow key={name} name={name} count={count} names={names} onDone={load} flash={flash} />
              ))}
              <div className="set-hint">
                Renaming a folder to the name of another one merges them. Removing a folder keeps its notes; they
                move to unsorted. The matching folders in Transcripts follow along.
              </div>
            </div>
          </section>

          <section className="panel set-panel">
            <div className="panel-head">
              screenshots <span>{data.shots.count} · {mb(data.shots.bytes)}</span>
            </div>
            <div className="set-body">
              {data.shots.notes.length === 0 && (
                <div className="set-hint">None yet. Add them from the “yours” panel on any note.</div>
              )}
              {data.shots.notes.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`} className="set-shotnote">
                  <div className="set-shotstrip">
                    {n.shots.slice(0, 6).map((f) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={f} src={`/api/notes/${n.id}/shots/${f}`} alt="" loading="lazy" />
                    ))}
                    {n.shots.length > 6 && <span className="set-more">+{n.shots.length - 6}</span>}
                  </div>
                  <span className="set-shottitle">{n.title || "Untitled"}</span>
                  <span className="set-count">{n.shots.length}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel set-panel">
            <div className="panel-head">
              storage & files <span>{data.noteCount} notes</span>
            </div>
            <div className="set-body">
              <div className="set-row">
                <span className="set-grow">Notes (transcripts, summaries, your notes)</span>
                <span className="set-count">{mb(data.storage.notes)}</span>
              </div>
              <div className="set-row">
                <span className="set-grow">Media (thumbnails, captions, screenshots, audio)</span>
                <span className="set-count">{mb(data.storage.media)}</span>
              </div>
              <div className="set-row">
                <span className="set-grow">
                  Markdown copies
                  <span className="set-path">{data.storage.transcriptsDir}</span>
                </span>
                <span className="set-count">{mb(data.storage.transcripts)}</span>
              </div>
              <div className="set-actions">
                <button
                  className="btn"
                  onClick={() => act("open", async () => {
                    await post("/api/settings", { action: "open-transcripts" });
                    flash("opened in Finder on the Mac");
                  })}
                >
                  open in finder
                </button>
                <button
                  className="btn"
                  disabled={busy === "resync"}
                  onClick={() => act("resync", async () => {
                    const r = await post("/api/settings", { action: "resync" });
                    flash(`rewrote ${r.count} markdown files`);
                    load();
                  })}
                >
                  {busy === "resync" ? "rewriting…" : "rewrite all .md files"}
                </button>
                <button
                  className="btn"
                  disabled={!data.storage.audioFiles || busy === "audio"}
                  onClick={() => {
                    if (!confirm(`Delete ${data.storage.audioFiles} leftover audio files (${mb(data.storage.audioBytes)})? They were only needed to make the transcripts, which stay. This can't be undone.`)) return;
                    act("audio", async () => {
                      const r = await post("/api/settings", { action: "clear-audio" });
                      flash(`cleared ${r.count} audio files · freed ${mb(r.freed)}`);
                      load();
                    });
                  }}
                >
                  {data.storage.audioFiles
                    ? `clear leftover audio · ${mb(data.storage.audioBytes)}`
                    : "no leftover audio"}
                </button>
              </div>
            </div>
          </section>

          <section className="panel set-panel">
            <div className="panel-head">
              claude <span>{claude ? (claude.ok ? "signed in" : "signed out") : "checking…"}</span>
            </div>
            <div className="set-body">
              <div className="set-hint" style={{ marginTop: 0 }}>
                Summaries, research packs, translations and book lists run through Claude on your subscription.
                {claude && !claude.ok && claude.reason ? ` (${claude.reason})` : ""}
              </div>
              <div className="set-actions">
                <button
                  className="btn"
                  disabled={busy === "check"}
                  onClick={() => act("check", async () => {
                    const r = await post("/api/claude", { action: "check" });
                    setClaude(r);
                    flash(r.ok ? "Claude is signed in" : "still signed out");
                  })}
                >
                  {busy === "check" ? "checking…" : "check now"}
                </button>
                {claude && !claude.ok && (
                  <button
                    className="btn btn-primary"
                    onClick={() => act("login", async () => {
                      await post("/api/claude", { action: "login" });
                      flash("Terminal opened on the Mac — finish signing in there");
                    })}
                  >
                    sign in
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="panel set-panel">
            <div className="panel-head">
              this device <span>saved in this browser only</span>
            </div>
            <div className="set-body">
              <div className="set-row">
                <span className="set-grow">Appearance</span>
                {["system", "light", "dark"].map((t) => (
                  <button key={t} className={`chip ${theme === t ? "active" : ""}`} onClick={() => applyTheme(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="set-row">
                <span className="set-grow">Remembered library filters</span>
                <button
                  className="chip"
                  onClick={() => {
                    try {
                      localStorage.removeItem("td-filters");
                    } catch {
                      /* storage blocked */
                    }
                    flash("filters reset");
                  }}
                >
                  reset
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
