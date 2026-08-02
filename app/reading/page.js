"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// fixed-size cover with a quiet placeholder — every book the same shape
function Cover({ id, title }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <div className="book-cover ph">{(title || "?").trim()[0]?.toUpperCase()}</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="book-cover"
      src={`/api/books/${id}/cover`}
      alt=""
      loading="lazy"
      onError={() => setOk(false)}
    />
  );
}

export default function ReadingPage() {
  const [books, setBooks] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [status, setStatus] = useState(null); // null = all, false = unread, true = read
  const [tag, setTag] = useState(null);
  const [showAllTags, setShowAllTags] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      const data = await res.json();
      setBooks(data.books || []);
    } catch {
      /* retry on next action */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function add(e) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add the book.");
      setTitle("");
      if (data.existed) showToast("already on the list");
      load();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRead(b) {
    setBooks((prev) => prev.map((x) => (x.id === b.id ? { ...x, read: !b.read } : x))); // optimistic
    const res = await fetch(`/api/books/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: !b.read }),
    });
    if (!res.ok) load(); // revert on failure
  }

  async function remove(id) {
    if (!confirm("Remove this book from the list?")) return;
    await fetch(`/api/books/${id}`, { method: "DELETE" });
    load();
  }

  function asMarkdown() {
    return (books || [])
      .map(
        (b) =>
          `- **${b.title}**${b.author ? ` — ${b.author}` : ""}${
            b.description ? `\n  ${b.description}` : ""
          }${b.tags?.length ? `\n  _${b.tags.join(" · ")}_` : ""}`
      )
      .join("\n");
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(asMarkdown());
      showToast("reading list copied");
    } catch {
      showToast("copy failed — use download instead");
    }
  }

  function downloadMd() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`# Reading list\n\n${asMarkdown()}\n`], { type: "text/plain" }));
    a.download = "reading-list.md";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main>
      <Link className="backlink" href="/">← library</Link>

      <div className="library-head" style={{ marginTop: 10 }}>
        <span className="micro" style={{ color: "var(--ink)" }}>
          reading list {books ? `(${books.length})` : ""}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-plain" onClick={copyAll}>copy</button>
          <button className="btn btn-plain" onClick={downloadMd}>.md</button>
        </span>
      </div>

      <form className="url-row" onSubmit={add} style={{ marginBottom: 8 }}>
        <input
          className="url-input"
          placeholder="Add a book by title — author and details fill themselves in…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary submit-btn" disabled={busy || !title.trim()}>
          {busy ? "adding…" : "add"}
        </button>
      </form>
      {error && <div className="error-box">{error}</div>}

      {books && books.length === 0 && (
        <div className="empty">nothing here yet — add the first book above</div>
      )}

      {books && books.length > 0 && (
        <div className="folder-row" style={{ marginTop: 26 }}>
          <button className={`chip ${status === null ? "active" : ""}`} onClick={() => setStatus(null)}>
            all ({books.length})
          </button>
          <button
            className={`chip ${status === false ? "active" : ""}`}
            onClick={() => setStatus(status === false ? null : false)}
          >
            unread ({books.filter((b) => !b.read).length})
          </button>
          <button
            className={`chip ${status === true ? "active" : ""}`}
            onClick={() => setStatus(status === true ? null : true)}
          >
            read ({books.filter((b) => b.read).length})
          </button>
          {(() => {
            const all = [...new Set(books.flatMap((b) => b.tags || []))];
            const count = (t) => books.filter((b) => b.tags?.includes(t)).length;
            const sorted = all.sort((a, z) => count(z) - count(a));
            // tidy: only tags shared by 2+ books up front, the rest behind "more"
            let main = sorted.filter((t) => count(t) >= 2).slice(0, 8);
            if (!main.length) main = sorted.slice(0, 5);
            if (tag && !main.includes(tag)) main = [...main, tag];
            const extra = sorted.filter((t) => !main.includes(t));
            const shown = showAllTags ? [...main, ...extra] : main;
            return (
              <>
                {shown.map((t) => (
                  <button
                    key={t}
                    className={`chip ${tag === t ? "active" : ""}`}
                    style={tag === t ? {} : { color: "var(--muted)" }}
                    onClick={() => setTag(tag === t ? null : t)}
                  >
                    #{t}
                  </button>
                ))}
                {extra.length > 0 && (
                  <button
                    className="chip"
                    style={{ color: "var(--faint)" }}
                    onClick={() => setShowAllTags(!showAllTags)}
                  >
                    {showAllTags ? "less" : `+${extra.length} more`}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {(books || [])
          .filter((b) => (status === null || Boolean(b.read) === status) && (!tag || b.tags?.includes(tag)))
          .map((b) => (
          <div className="book-row" key={b.id}>
            <button
              className={`read-dot ${b.read ? "is-read" : ""}`}
              onClick={() => toggleRead(b)}
              title={b.read ? "Read — click to mark unread" : "Unread — click to mark read"}
            />
            <Cover id={b.id} title={b.title} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="book-title">
                {b.title}
                {b.author && <span className="book-author"> — {b.author}</span>}
              </div>
              {b.description && <div className="book-desc">{b.description}</div>}
              <div className="note-meta" style={{ marginTop: 6 }}>
                {(b.tags || []).map((t) => (
                  <span key={t} className="badge-tag">#{t}</span>
                ))}
                <span>{new Date(b.createdAt).toLocaleDateString()}</span>
                {b.source?.noteId && (
                  <Link href={`/notes/${b.source.noteId}`} className="meta-link">
                    via {(b.source.noteTitle || "note").slice(0, 40)}
                  </Link>
                )}
              </div>
            </div>
            <button
              className="btn btn-plain btn-sm book-copy"
              title="Copy title + author for searching Kindle/Google"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${b.title}${b.author ? ` ${b.author}` : ""}`);
                  showToast("copied — paste into kindle / google");
                } catch {
                  showToast("copy failed");
                }
              }}
            >
              copy
            </button>
            <button className="card-delete book-delete" onClick={() => remove(b.id)} title="Remove">
              ×
            </button>
          </div>
        ))}
      </div>

      {toast && <div className="copied-toast">{toast}</div>}
    </main>
  );
}
