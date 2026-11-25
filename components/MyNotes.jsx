"use client";

// Your own layer on a note: screenshots from the video, how you intend to
// use it, and free notes. Text autosaves; screenshots upload from a button
// (phone photo library works) or by pasting an image anywhere on the page.

import { useEffect, useRef, useState } from "react";

export default function MyNotes({ id, initial, onNote, toast }) {
  // seeded once per note — background refreshes never clobber typing
  const [intent, setIntent] = useState(initial.intent || "");
  const [myNotes, setMyNotes] = useState(initial.myNotes || "");
  const [shots, setShots] = useState(initial.shots || []);
  const [saveState, setSaveState] = useState(null); // null | "saving" | "saved" | "error"
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef(null);
  const timer = useRef(null);
  const dirty = useRef(false);

  function queueSave(patch) {
    dirty.current = true;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/notes/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch()),
        });
        if (!res.ok) throw new Error();
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 700);
  }

  const intentRef = useRef(intent);
  const notesRef = useRef(myNotes);
  intentRef.current = intent;
  notesRef.current = myNotes;

  // save on the way out if a keystroke is still pending
  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      navigator.sendBeacon?.(
        `/api/notes/${id}/save`,
        new Blob([JSON.stringify({ intent: intentRef.current, myNotes: notesRef.current })], {
          type: "application/json",
        })
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [id]);

  async function upload(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name));
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("file", f));
      const res = await fetch(`/api/notes/${id}/shots`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setShots(data.note.shots || []);
      onNote?.(data.note);
      toast?.(files.length === 1 ? "screenshot added" : `${files.length} screenshots added`);
    } catch (err) {
      toast?.(String(err.message || err));
    } finally {
      setUploading(false);
    }
  }

  // paste an image anywhere on the page (⌘⇧⌃4 then ⌘V on the Mac)
  useEffect(() => {
    function onPaste(e) {
      const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      e.preventDefault();
      upload(imgs);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // re-bind each render so upload sees current state

  async function removeShot(file) {
    if (!confirm("Delete this screenshot?")) return;
    const res = await fetch(`/api/notes/${id}/shots/${file}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setShots(data.note.shots || []);
      onNote?.(data.note);
    }
  }

  // esc closes the viewer
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e) => e.key === "Escape" && setViewing(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  return (
    <div className="panel mynotes">
      <div className="panel-head">
        yours
        <span>
          {saveState === "saving" && "saving…"}
          {saveState === "saved" && "saved"}
          {saveState === "error" && <span style={{ color: "var(--danger)" }}>not saved — check the connection</span>}
        </span>
      </div>
      <div className="mynotes-grid">
        <div className="mynotes-text">
          <label className="micro" htmlFor="intent">how I'll use it</label>
          <textarea
            id="intent"
            className="mynotes-input"
            rows={2}
            placeholder="e.g. hook for the Studio article on brand trust"
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value);
              queueSave(() => ({ intent: e.target.value }));
            }}
          />
          <label className="micro" htmlFor="mynotes">notes</label>
          <textarea
            id="mynotes"
            className="mynotes-input grow"
            rows={6}
            placeholder="ideas, quotes to reuse, what to look up…"
            value={myNotes}
            onChange={(e) => {
              setMyNotes(e.target.value);
              queueSave(() => ({ myNotes: e.target.value }));
            }}
          />
        </div>
        <div className="mynotes-shots">
          <div className="micro" style={{ marginBottom: 8 }}>
            screenshots {shots.length ? `(${shots.length})` : ""}
          </div>
          <div className="shot-grid">
            {shots.map((s) => (
              <div className="shot" key={s.file}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/notes/${id}/shots/${s.file}`}
                  alt=""
                  loading="lazy"
                  onClick={() => setViewing(s.file)}
                />
                <button className="card-delete" onClick={() => removeShot(s.file)} title="Delete screenshot">
                  ×
                </button>
              </div>
            ))}
            <button className="shot-add" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "adding…" : "+ add"}
            </button>
          </div>
          <div className="micro" style={{ marginTop: 8, color: "var(--faint)" }}>
            or paste an image anywhere on this page
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const f = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              upload(f);
            }}
          />
        </div>
      </div>

      {viewing && (
        <div className="shot-viewer" onClick={() => setViewing(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/notes/${id}/shots/${viewing}`} alt="" />
        </div>
      )}
    </div>
  );
}
