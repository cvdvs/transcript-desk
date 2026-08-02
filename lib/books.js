// The reading list: deliberately isolated from notes — just books you want
// to remember. Stored in data/books.json, mirrored to
// ~/Documents/Transcripts/reading-list.md, autofilled by the small model.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, newId } from "./store";
import { TRANSCRIPTS_DIR } from "./mdsync";
import { claudeCall } from "./pipeline";
import { noteText } from "./prompts";

const BOOKS_PATH = path.join(DATA_DIR, "books.json");

export function listBooks() {
  try {
    return JSON.parse(fs.readFileSync(BOOKS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeBooks(books) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = BOOKS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(books, null, 2));
  fs.renameSync(tmp, BOOKS_PATH);
  mirrorBooks(books);
}

const MIRROR_MARKER = "<!-- transcript-desk:reading-list -->";

// keep a copyable markdown version next to the transcripts — but never
// overwrite a file we don't own (a note could be titled "Reading list")
function mirrorBooks(books) {
  try {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    const dest = path.join(TRANSCRIPTS_DIR, "reading-list.md");
    if (fs.existsSync(dest)) {
      const head = fs.readFileSync(dest, "utf8").slice(0, 200);
      if (!head.includes(MIRROR_MARKER)) return; // not ours — leave it alone
    }
    const lines = [MIRROR_MARKER, "", "# Reading list", ""];
    for (const b of books) {
      lines.push(`- [${b.read ? "x" : " "}] **${b.title}**${b.author ? ` — ${b.author}` : ""}`);
      if (b.description) lines.push(`  ${b.description}`);
      if (b.tags?.length) lines.push(`  _${b.tags.join(" · ")}_`);
      lines.push("");
    }
    fs.writeFileSync(dest, lines.join("\n"));
  } catch {
    /* mirror is best-effort */
  }
}

export function booksToMarkdown(books) {
  return books
    .map(
      (b) =>
        `- [${b.read ? "x" : " "}] **${b.title}**${b.author ? ` — ${b.author}` : ""}${
          b.description ? `\n  ${b.description}` : ""
        }${b.tags?.length ? `\n  _${b.tags.join(" · ")}_` : ""}`
    )
    .join("\n");
}

// Ask the small model for author + one-line description + tags. Best-effort:
// on any failure the book is saved with whatever the user typed.
async function autofill(title, authorHint) {
  const prompt = `Return ONLY a JSON object, nothing else, for the book titled "${title}"${
    authorHint ? ` (author hint: ${authorHint})` : ""
  }:
{"author": "full author name", "description": "one factual sentence about what the book is", "tags": ["tag1", "tag2", "tag3"]}
If you don't recognize the book, give your best guess and keep the description generic. Tags: lowercase, broad categories (e.g. philosophy, design, fiction, mathematics).`;
  const result = await claudeCall(prompt, "haiku", 120000);
  if (!result.ok) return null;
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const d = JSON.parse(m[0]);
    return {
      author: typeof d.author === "string" ? d.author.slice(0, 100) : null,
      description: typeof d.description === "string" ? d.description.slice(0, 300) : null,
      tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === "string").slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

export async function addBook({ title, author, source }) {
  const clean = String(title || "").trim().slice(0, 200);
  if (!clean) throw new Error("A title is needed.");
  const books = listBooks();
  const existing = books.find((b) => normTitle(b.title) === normTitle(clean));
  if (existing) return { book: existing, existed: true }; // keep the list lean
  const filled = await autofill(clean, author);
  const book = {
    id: newId(),
    title: clean,
    author: (author || filled?.author || "").trim().slice(0, 100) || null,
    description: filled?.description || null,
    tags: filled?.tags || [],
    read: false,
    source: source || null,
    createdAt: new Date().toISOString(),
  };
  books.unshift(book);
  writeBooks(books);
  return { book, existed: false };
}

export function updateBook(id, patch) {
  const books = listBooks();
  const i = books.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const allowed = {};
  for (const k of ["title", "author", "description", "tags", "read"]) {
    if (k in patch) allowed[k] = k === "read" ? Boolean(patch[k]) : patch[k];
  }
  books[i] = { ...books[i], ...allowed };
  writeBooks(books);
  return books[i];
}

export function deleteBook(id) {
  const books = listBooks().filter((b) => b.id !== id);
  writeBooks(books);
}

function normTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, ""); // "The Song of Achilles" == "Song of Achilles"
}

// Reads a note (BookTok transcript, tweet, article…) and pulls every book it
// mentions into the reading list — the first tag carries the source's own
// framing ("weird girl lit", "greek mythology retelling").
export async function extractBooksFromNote(note) {
  const { text } = noteText(note, 12000);
  if (!text.trim()) throw new Error("This note has no text yet.");

  const prompt = `You are reading a captured ${note.kind || "video transcript"}. List every BOOK it mentions or recommends.

Return ONLY a JSON array, nothing else:
[{"title": "...", "author": "...", "description": "one sentence — prefer what the source says about the book, else what the book factually is", "tags": ["vibe", "genre"]}]

Rules:
- tags: 2–4, lowercase. The FIRST tag captures how the source frames these books, in the source's own words or spirit (e.g. "weird girl lit", "greek mythology retelling", "summer yearning") — reuse the same first tag for books the source groups together. Then 1–2 standard genre/category tags.
- author: as stated in the text; if unstated but you know the real author, use that; else "".
- Only actual books — no films, articles, or series-as-a-whole unless named as a book.
- If no books are mentioned, return [].

Text:
${text}`;

  const result = await claudeCall(prompt, "haiku", 240000);
  if (!result.ok) throw new Error(result.reason);
  const m = result.text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("Couldn't find any books in this note.");
  let found;
  try {
    found = JSON.parse(m[0]);
  } catch {
    throw new Error("The book extraction came back malformed — try again.");
  }

  const books = listBooks();
  const byTitle = new Map(books.map((b) => [normTitle(b.title), b]));
  let added = 0;
  let merged = 0;
  for (const f of found) {
    const title = String(f?.title || "").trim().slice(0, 200);
    if (!title) continue;
    const tags = Array.isArray(f.tags)
      ? f.tags.filter((t) => typeof t === "string").map((t) => t.trim().toLowerCase()).slice(0, 4)
      : [];
    const existing = byTitle.get(normTitle(title));
    if (existing) {
      const before = new Set(existing.tags || []);
      existing.tags = [...new Set([...(existing.tags || []), ...tags])].slice(0, 6);
      if (existing.tags.length > before.size) merged++;
      continue;
    }
    const book = {
      id: newId(),
      title,
      author: String(f?.author || "").trim().slice(0, 100) || null,
      description: String(f?.description || "").trim().slice(0, 300) || null,
      tags,
      source: { noteId: note.id, noteTitle: note.title || null, url: note.source?.url || null },
      createdAt: new Date().toISOString(),
    };
    books.unshift(book);
    byTitle.set(normTitle(title), book);
    added++;
  }
  writeBooks(books);
  return { added, merged, total: found.length };
}
