"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { marked } from "marked";
import { toBlocks, formatTimestamp } from "../../../lib/subtitles";
import { clipboardResearchPrompt, transcriptToText } from "../../../lib/prompts";
import Thumb from "../../../components/Thumb";
import AsciiSpinner from "../../../components/AsciiSpinner";

const STATUS_LABELS = {
  queued: ["queued", "Waiting for the pipeline to pick this up."],
  waiting: ["in line", "Another transcription is running — this one starts automatically after it."],
  fetching: ["fetching info", "Reading title, duration, and available captions."],
  reading: ["extracting text", "Pulling the text out — including any text inside images."],
  downloading: ["downloading audio", "No captions available — pulling the audio track instead."],
  transcribing: ["transcribing", "Whisper is running locally. Longer videos take a few minutes."],
  summarizing: ["writing summary", "The transcript is ready — Claude is writing the summary and chapters."],
};

function youtubeId(url = "") {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/
  );
  return m ? m[1] : null;
}

function slugify(s) {
  return (s || "transcript").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toSrt(segments) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const ts = (sec) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const wholeSec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(wholeSec)},${pad(ms, 3)}`;
  };
  return segments
    .map((seg, i) => `${i + 1}\n${ts(seg.start)} --> ${ts(seg.end)}\n${seg.text}\n`)
    .join("\n");
}

export default function NotePage() {
  const { id } = useParams();
  const router = useRouter();
  const [note, setNote] = useState(null);
  const [missing, setMissing] = useState(false);
  const [toast, setToast] = useState(null);
  const [actionError, setActionError] = useState(null); // persistent, dismissible
  const [researchBusy, setResearchBusy] = useState(false);
  const [translateBusy, setTranslateBusy] = useState(false);
  const [folders, setFolders] = useState([]);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (res.status === 404) {
        setMissing(true);
        return null;
      }
      const data = await res.json();
      setNote(data.note);
      return data.note;
    } catch {
      return null;
    }
  }, [id]);

  useEffect(() => {
    load();
    // existing folder names for the move-to control
    fetch("/api/notes")
      .then((r) => r.json())
      .then((d) => setFolders([...new Set((d.notes || []).map((n) => n.folder).filter(Boolean))].sort()))
      .catch(() => {});
  }, [load]);

  // Poll while the note is processing or a research pack / translation runs
  // server-side. Depending on the note's flags means polling RESUMES whenever
  // any fetch discovers work in flight — even if it had already stopped.
  const pollActive =
    !missing &&
    (!note ||
      !["ready", "error"].includes(note.status) ||
      note.researchStatus === "running" ||
      note.translationStatus === "running");

  useEffect(() => {
    if (!pollActive) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [pollActive, note, load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // navigator.clipboard only exists on https/localhost — over plain http from
  // the phone it is undefined, so fall back to the old textarea trick.
  async function copy(text, label) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(label);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(ok ? label : "copy failed — select manually");
    } catch {
      showToast("copy failed — select manually");
    }
  }

  async function generateResearch() {
    setResearchBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/notes/${id}/research`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research pack failed.");
      setNote(data.note);
      if (data.note?.research) showToast("research pack ready");
    } catch (err) {
      setActionError(String(err.message || err)); // persistent — login fixes etc. need reading time
      load(); // refresh — the server may still be running or have completed
    } finally {
      setResearchBusy(false);
    }
  }

  async function generateTranslationClick() {
    setTranslateBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/notes/${id}/translate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Translation failed.");
      setNote(data.note);
      if (data.note?.translation) showToast("translation ready");
    } catch (err) {
      setActionError(String(err.message || err)); // persistent — login fixes etc. need reading time
      load(); // refresh — the server may still be running or have completed
    } finally {
      setTranslateBusy(false);
    }
  }

  async function assignFolder(value) {
    const res = await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: value }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "couldn't move note");
      return;
    }
    setNote(data.note);
    if (value && !folders.includes(value)) setFolders([...folders, value].sort());
    showToast(value ? `moved to ${value}` : "removed from folder");
  }

  async function retryNote() {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: note.source.url }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "retry failed");
      return;
    }
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    router.push(`/notes/${data.id}`);
  }

  async function removeNote() {
    if (!confirm("Delete this note and its files?")) return;
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    router.push("/");
  }

  if (missing) {
    return (
      <main>
        <Link className="backlink" href="/">← library</Link>
        <div className="empty">this note doesn&apos;t exist (anymore)</div>
      </main>
    );
  }

  if (!note) {
    return (
      <main>
        <Link className="backlink" href="/">← library</Link>
        <div className="status-banner">
          <AsciiSpinner />
          <span className="status-title">loading</span>
        </div>
      </main>
    );
  }

  const processing = STATUS_LABELS[note.status];
  const segments = note.transcript?.segments || [];
  const blocks = toBlocks(segments);
  const ytId = note.source?.url ? youtubeId(note.source.url) : null;
  const slug = slugify(note.title);
  const words = segments.reduce((a, s) => a + s.text.split(/\s+/).length, 0);

  const chapters = note.chapters || [];

  // Interleave chapter headings into the transcript blocks. A chapter lands
  // before the block that CONTAINS its timestamp (start < block end) — not
  // after it. Chapters past the last block are dropped, never left dangling.
  const transcriptItems = [];
  {
    let ci = 0;
    for (const b of blocks) {
      while (ci < chapters.length && chapters[ci].start < b.end) {
        transcriptItems.push({ type: "chapter", ...chapters[ci] });
        ci++;
      }
      transcriptItems.push({ type: "block", ...b });
    }
  }

  const plainTranscript = transcriptItems
    .map((it) =>
      it.type === "chapter"
        ? `\n### ${it.title} — ${formatTimestamp(it.start)}\n`
        : `[${formatTimestamp(it.start)}] ${it.text}`
    )
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");

  // text captures (tweets, articles, images) carry a markdown body instead
  const contentText = note.body || plainTranscript;
  const hasText = segments.length > 0 || Boolean(note.body);

  function markdownExport() {
    const lines = [
      `# ${note.title || "Transcript"}`,
      "",
      note.source?.url ? `Source: ${note.source.url}` : null,
      note.source?.uploader ? `Creator: ${note.source.uploader}` : null,
      note.duration ? `Duration: ${formatTimestamp(note.duration)}` : null,
      `Saved: ${new Date(note.createdAt).toLocaleString()}`,
      "",
    ].filter((l) => l !== null);
    if (note.summary?.text) lines.push("## Summary", "", note.summary.text, "");
    if (note.research?.text) lines.push("## Research pack", "", note.research.text, "");
    if (note.translation?.text) lines.push("## Translation", "", note.translation.text, "");
    if (note.body) lines.push("## Text", "", note.body, "");
    else lines.push("## Transcript", "", plainTranscript, "");
    return lines.join("\n");
  }

  function timestampLink(start) {
    if (!ytId) return null;
    return `https://www.youtube.com/watch?v=${ytId}&t=${Math.floor(start)}s`;
  }

  return (
    <main>
      <Link className="backlink" href="/">← library</Link>

      <div className="note-header">
        <h1>{note.title || "Untitled"}</h1>
        <div className="note-meta">
          {note.source?.platform && <span>{note.source.platform}</span>}
          {note.source?.uploader && <span>{note.source.uploader}</span>}
          {note.duration ? <span>{formatTimestamp(note.duration)}</span> : null}
          {words > 0 && <span>{words.toLocaleString()} words</span>}
          {note.transcript?.method && (
            <span>via {note.transcript.method === "captions" ? "captions" : "whisper · local"}</span>
          )}
          {note.source?.url && (
            <a href={note.source.url} target="_blank" rel="noreferrer" className="meta-link">
              open original ↗
            </a>
          )}
        </div>
      </div>

      {processing && (
        <div className="status-banner">
          <AsciiSpinner />
          <div>
            <div className="status-title">{processing[0]}</div>
            <div className="status-sub">{processing[1]}</div>
          </div>
        </div>
      )}

      {note.status === "error" && (
        <div className="status-banner" style={{ borderColor: "var(--danger)" }}>
          <div>
            <div className="status-title" style={{ color: "var(--danger)" }}>
              something went wrong
            </div>
            <div className="status-sub">{note.error}</div>
          </div>
        </div>
      )}

      {note.status === "ready" && !note.summary && note.summaryNote && (
        <div className="status-banner">
          <div>
            <div className="status-title">transcript ready — summary skipped</div>
            <div className="status-sub">{note.summaryNote}</div>
          </div>
        </div>
      )}

      {note.playlistNote && (
        <div className="status-banner">
          <div>
            <div className="status-title">playlist</div>
            <div className="status-sub">{note.playlistNote}</div>
          </div>
        </div>
      )}

      {actionError && (
        <div className="status-banner" style={{ borderColor: "var(--danger)" }}>
          <div style={{ flex: 1 }}>
            <div className="status-title" style={{ color: "var(--danger)" }}>
              that didn&apos;t work
            </div>
            <div className="status-sub">{actionError}</div>
          </div>
          <button className="btn btn-plain" onClick={() => setActionError(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* always rendered: folder + delete work in every state, including
          mid-processing (batch uploads get filed right away) */}
      <div className="actions-bar">
          {hasText && (
            <>
              <button className="btn" onClick={() => copy(contentText, note.body ? "text copied" : "transcript copied")}>
                {note.body ? "copy text" : "copy transcript"}
              </button>
              {note.summary?.text && (
                <button className="btn" onClick={() => copy(note.summary.text, "summary copied")}>
                  copy summary
                </button>
              )}
              <button
                className="btn"
                onClick={() =>
                  copy(
                    clipboardResearchPrompt(note, note.body || transcriptToText(segments).text),
                    "claude prompt copied"
                  )
                }
              >
                copy claude prompt
              </button>
              <button className="btn btn-plain" onClick={() => download(`${slug}.md`, markdownExport())}>
                .md
              </button>
              <button className="btn btn-plain" onClick={() => download(`${slug}.txt`, contentText)}>
                .txt
              </button>
              {segments.length > 0 && (
                <button className="btn btn-plain" onClick={() => download(`${slug}.srt`, toSrt(segments))}>
                  .srt
                </button>
              )}
              {!note.research && (
                <button
                  className="btn btn-primary"
                  onClick={generateResearch}
                  disabled={researchBusy || note.researchStatus === "running"}
                >
                  {researchBusy || note.researchStatus === "running"
                    ? "analyzing… 1–2 min"
                    : "research pack"}
                </button>
              )}
              {!note.translation && (
                <button
                  className="btn"
                  onClick={generateTranslationClick}
                  disabled={translateBusy || note.translationStatus === "running"}
                >
                  {translateBusy || note.translationStatus === "running"
                    ? "translating…"
                    : "translate ro⇄en"}
                </button>
              )}
            </>
          )}
          {note.status === "error" && note.source?.type === "url" && note.source?.url && (
            <button className="btn btn-primary" onClick={retryNote}>
              try again
            </button>
          )}
          {newFolderMode ? (
            <span style={{ display: "flex", gap: 6 }}>
              <input
                className="folder-input"
                placeholder="folder name"
                value={newFolderName}
                autoFocus
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim()) {
                    assignFolder(newFolderName.trim());
                    setNewFolderMode(false);
                    setNewFolderName("");
                  }
                  if (e.key === "Escape") setNewFolderMode(false);
                }}
              />
              <button
                className="btn"
                onClick={() => {
                  if (newFolderName.trim()) assignFolder(newFolderName.trim());
                  setNewFolderMode(false);
                  setNewFolderName("");
                }}
              >
                save
              </button>
            </span>
          ) : (
            <select
              className="folder-select"
              value={note.folder || ""}
              onChange={(e) => {
                if (e.target.value === "__new__") setNewFolderMode(true);
                else assignFolder(e.target.value || null);
              }}
            >
              <option value="">no folder</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value="__new__">new folder…</option>
            </select>
          )}
          <button className="btn btn-danger" onClick={removeNote} style={{ marginLeft: "auto" }}>
            delete
          </button>
      </div>

      <div className="note-layout">
        <div className="stack">
          {(ytId || note.thumbnail || note.source?.type === "file") && (
            <div className="panel">
              {ytId ? (
                <iframe
                  className="video-embed"
                  src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                  title="Video"
                  allowFullScreen
                />
              ) : (
                <Thumb src={note.thumbnail} seed={note.title || id} large />
              )}
            </div>
          )}

          {note.summary?.text && (
            <div className="panel">
              <div className="panel-head">
                summary
                <button className="btn btn-plain" onClick={() => copy(note.summary.text, "summary copied")}>
                  copy
                </button>
              </div>
              <div className="panel-body md" dangerouslySetInnerHTML={{ __html: marked.parse(note.summary.text) }} />
            </div>
          )}

          {note.research?.text && (
            <div className="panel">
              <div className="panel-head">
                research pack
                <button className="btn btn-plain" onClick={() => copy(note.research.text, "research pack copied")}>
                  copy
                </button>
              </div>
              <div className="panel-body md" dangerouslySetInnerHTML={{ __html: marked.parse(note.research.text) }} />
            </div>
          )}

          {note.translation?.text && (
            <div className="panel">
              <div className="panel-head">
                translation
                <button className="btn btn-plain" onClick={() => copy(note.translation.text, "translation copied")}>
                  copy
                </button>
              </div>
              <div className="panel-body plain-text">{note.translation.text}</div>
            </div>
          )}
        </div>

        {note.body && (
          <div className="panel">
            <div className="panel-head">
              text
              <button className="btn btn-plain" onClick={() => copy(note.body, "text copied")}>
                copy
              </button>
            </div>
            <div
              className="panel-body md transcript"
              dangerouslySetInnerHTML={{ __html: marked.parse(note.body) }}
            />
          </div>
        )}

        {segments.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              transcript
              <span>{blocks.length} {blocks.length === 1 ? "section" : "sections"}</span>
            </div>
            <div className="transcript">
              {transcriptItems.map((it, i) =>
                it.type === "chapter" ? (
                  <div className="chapter-head" key={i}>
                    {it.title}
                    <span>{formatTimestamp(it.start)}</span>
                  </div>
                ) : (
                  <div className="seg" key={i}>
                    {timestampLink(it.start) ? (
                      <a className="seg-time" href={timestampLink(it.start)} target="_blank" rel="noreferrer">
                        {formatTimestamp(it.start)}
                      </a>
                    ) : (
                      <span className="seg-time">{formatTimestamp(it.start)}</span>
                    )}
                    <div className="seg-text">{it.text}</div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {toast && <div className="copied-toast">{toast}</div>}
    </main>
  );
}
