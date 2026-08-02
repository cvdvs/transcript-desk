"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export default function ReadingPage() {
  const [books, setBooks] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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
      load();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
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

      <div style={{ marginTop: 26 }}>
        {(books || []).map((b) => (
          <div className="book-row" key={b.id}>
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
              </div>
            </div>
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
