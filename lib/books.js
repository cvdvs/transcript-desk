// The reading list: deliberately isolated from notes — just books you want
// to remember. Stored in data/books.json, mirrored to
// ~/Documents/Transcripts/reading-list.md, autofilled by the small model.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, newId } from "./store";
import { TRANSCRIPTS_DIR } from "./mdsync";
import { claudeCall } from "./pipeline";

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
      lines.push(`- **${b.title}**${b.author ? ` — ${b.author}` : ""}`);
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
        `- **${b.title}**${b.author ? ` — ${b.author}` : ""}${
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
  const filled = await autofill(clean, author);
  const book = {
    id: newId(),
    title: clean,
    author: (author || filled?.author || "").trim().slice(0, 100) || null,
    description: filled?.description || null,
    tags: filled?.tags || [],
    source: source || null,
    createdAt: new Date().toISOString(),
  };
  const books = listBooks();
  books.unshift(book);
  writeBooks(books);
  return book;
}

export function updateBook(id, patch) {
  const books = listBooks();
  const i = books.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const allowed = {};
  for (const k of ["title", "author", "description", "tags"]) {
    if (k in patch) allowed[k] = patch[k];
  }
  books[i] = { ...books[i], ...allowed };
  writeBooks(books);
  return books[i];
}

export function deleteBook(id) {
  const books = listBooks().filter((b) => b.id !== id);
  writeBooks(books);
}
