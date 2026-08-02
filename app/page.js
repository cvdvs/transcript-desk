"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "../lib/subtitles";
import Thumb from "../components/Thumb";

const PROCESSING = ["queued", "waiting", "fetching", "reading", "downloading", "transcribing", "summarizing"];

export default function Home() {
  const router = useRouter();
  const fileRef = useRef(null);
  const searchRef = useRef(null);
  const busyRef = useRef(false);
  const [notes, setNotes] = useState(null);
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [folder, setFolder] = useState(null); // null = all, "" = unsorted
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const searchRefQ = useRef("");

  // full-text search runs server-side (titles + transcripts + summaries)
  const load = useCallback(async () => {
    try {
      const q = searchRefQ.current.trim();
      const res = await fetch(q ? `/api/notes?q=${encodeURIComponent(q)}` : "/api/notes");
      const data = await res.json();
      if (searchRefQ.current.trim() === q) setNotes(data.notes || []);
    } catch {
      /* server restarting — next poll catches up */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  // debounce keystrokes → server query
  useEffect(() => {
    searchRefQ.current = search;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const submitLink = useCallback(
    async (link) => {
      if (!link?.trim() || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: link.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");
        router.push(`/notes/${data.id}`);
      } catch (err) {
        setError(String(err.message || err));
        busyRef.current = false;
        setBusy(false);
      }
    },
    [router]
  );

  const submitFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      if (busyRef.current) {
        setNotice("Still uploading the previous batch — try again in a moment.");
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      setError(null);

      // one file failing must not silently drop the rest of the batch
      const ids = [];
      const failed = [];
      for (const file of files) {
        if (file.size > 2 * 1024 * 1024 * 1024) {
          failed.push(`${file.name} (over 2 GB)`);
          continue;
        }
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/notes/upload", { method: "POST", body: form });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "upload failed");
          ids.push(data.id);
        } catch (err) {
          failed.push(`${file.name} (${String(err.message || err)})`);
        }
      }

      busyRef.current = false;
      setBusy(false);
      if (failed.length) setError(`Failed: ${failed.join(" · ")}`);
      if (ids.length === 1 && !failed.length) {
        router.push(`/notes/${ids[0]}`);
        return;
      }
      if (ids.length) setNotice(`Queued ${ids.length} file(s) — they transcribe one at a time.`);
      load();
    },
    [router, load]
  );

  // paste a link anywhere on the page — no need to focus the input first
  useEffect(() => {
    function onPaste(e) {
      const target = e.target;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (text && /^https?:\/\/\S+$/i.test(text)) {
        setUrl(text);
        submitLink(text);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [submitLink]);

  // "/" focuses search
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && e.target?.tagName !== "INPUT" && e.target?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // drag a file anywhere onto the window
  useEffect(() => {
    let depth = 0;
    function onDragEnter(e) {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes("Files")) {
        depth++;
        setDragging(true);
      }
    }
    function onDragOver(e) {
      e.preventDefault();
    }
    function onDragLeave(e) {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(e) {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) submitFiles(e.dataTransfer.files);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [submitFiles]);

  async function doRenameFolder() {
    const to = renameValue.trim();
    setRenamingFolder(false);
    if (!to || to === folder) return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", from: folder, to }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Rename failed.");
      return;
    }
    setFolder(to);
    load();
  }

  async function doDeleteFolder() {
    if (
      !confirm(`Remove the folder "${folder}"? The notes inside stay — they just become unsorted.`)
    )
      return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", name: folder }),
    });
    if (res.ok) {
      setFolder(null);
      load();
    }
  }

  async function removeNote(e, id) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this note and its files?")) return;
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    load();
  }

  // search happens server-side (full-text); folders filter client-side
  const all = notes || [];
  const folderNames = [...new Set(all.map((n) => n.folder).filter(Boolean))].sort();
  const unsortedCount = all.filter((n) => !n.folder).length;
  // keep the active chip visible even when search results / deletions empty
  // its folder — otherwise the filter gets stuck with no way to clear it
  const chipNames =
    folder && folder !== "" && !folderNames.includes(folder)
      ? [...folderNames, folder].sort()
      : folderNames;
  const showFolderRow = chipNames.length > 0 || folder !== null;
  const filtered = all.filter((n) => {
    if (folder === null) return true;
    if (folder === "") return !n.folder;
    return n.folder === folder;
  });

  return (
    <main>
      {dragging && <div className="drop-overlay">drop to transcribe</div>}

      <section className="newnote">
        <div className="micro" style={{ marginBottom: 14 }}>
          video → transcript → summary → research
        </div>
        <form
          className="url-row"
          onSubmit={(e) => {
            e.preventDefault();
            submitLink(url);
          }}
        >
          <input
            className="url-input"
            placeholder="Paste a link — videos, tweets, articles…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary submit-btn" disabled={busy || !url.trim()}>
            {busy ? "starting…" : "transcribe"}
          </button>
        </form>
        <div className="upload-hint micro">
          <span
            className="upload-link"
            onClick={() => !busy && fileRef.current?.click()}
            style={{ textTransform: "uppercase" }}
          >
            choose a file
          </span>
          <span>· or drop one anywhere · or paste a link anywhere</span>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,audio/*,image/*,.mkv,.webm"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files;
              const copied = files ? Array.from(files) : [];
              e.target.value = ""; // reset so re-picking the same file works after a failure
              submitFiles(copied);
            }}
          />
        </div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="notice-box">{notice}</div>}
      </section>

      <section>
        <div className="library-head">
          <span className="micro" style={{ color: "var(--ink)" }}>
            library ({notes ? notes.length : "…"})
          </span>
          <input
            ref={searchRef}
            className="search-input"
            placeholder="search  /"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {showFolderRow && (
          <div className="folder-row">
            <button className={`chip ${folder === null ? "active" : ""}`} onClick={() => setFolder(null)}>
              all ({all.length})
            </button>
            {chipNames.map((f) => (
              <button
                key={f}
                className={`chip ${folder === f ? "active" : ""}`}
                onClick={() => setFolder(folder === f ? null : f)}
              >
                {f} ({all.filter((n) => n.folder === f).length})
              </button>
            ))}
            {(unsortedCount > 0 || folder === "") && (
              <button
                className={`chip ${folder === "" ? "active" : ""}`}
                onClick={() => setFolder(folder === "" ? null : "")}
              >
                unsorted ({unsortedCount})
              </button>
            )}
            {folder && folder !== "" && !renamingFolder && (
              <>
                <button
                  className="chip"
                  style={{ marginLeft: 10 }}
                  onClick={() => {
                    setRenameValue(folder);
                    setRenamingFolder(true);
                  }}
                >
                  rename
                </button>
                <button className="chip chip-danger" onClick={doDeleteFolder}>
                  delete folder
                </button>
              </>
            )}
            {renamingFolder && (
              <span style={{ display: "flex", gap: 6, marginLeft: 10 }}>
                <input
                  className="folder-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doRenameFolder();
                    if (e.key === "Escape") setRenamingFolder(false);
                  }}
                />
                <button className="chip" onClick={doRenameFolder}>
                  save
                </button>
              </span>
            )}
          </div>
        )}

        {notes && filtered.length === 0 && (
          <div className="empty">
            {search.trim() || folder !== null
              ? "no notes match"
              : "nothing here yet — paste your first link"}
          </div>
        )}

        <div className="grid">
          {filtered.map((n) => (
            <a key={n.id} className="note-card" href={`/notes/${n.id}`}>
              <Thumb src={n.thumbnail} seed={n.title || n.id} />
              <button className="card-delete" onClick={(e) => removeNote(e, n.id)} title="Delete">
                ×
              </button>
              <div className="note-body">
                <div className="note-title">{n.title || "Untitled"}</div>
                {!n.snippet && n.excerpt && <div className="note-excerpt">{n.excerpt}</div>}
                <div className="note-meta">
                  {n.source?.platform && <span>{n.source.platform}</span>}
                  {n.folder && <span>▸ {n.folder}</span>}
                  {n.duration ? <span>{formatTimestamp(n.duration)}</span> : null}
                  <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                  {PROCESSING.includes(n.status) && (
                    <span className="blink">● {n.status === "waiting" ? "in line" : "processing"}</span>
                  )}
                  {n.status === "error" && <span className="badge-error">error</span>}
                </div>
                {n.snippet?.text && (
                  <div className="snippet">
                    {n.snippet.at != null && <span className="snippet-time">{formatTimestamp(n.snippet.at)} </span>}
                    {n.snippet.text}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
