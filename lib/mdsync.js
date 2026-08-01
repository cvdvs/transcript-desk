// Mirrors the note library into ~/Documents/Transcripts as formatted
// Markdown — one file per note, YAML frontmatter (Obsidian/Glyph friendly),
// subfolders matching the app's folders. Files move when a note is re-filed,
// update when research/translation are added, and are archived into
// _history/ (never deleted) when a note is removed in the app.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toBlocks, formatTimestamp } from "./subtitles";

export const TRANSCRIPTS_DIR =
  process.env.TD_TRANSCRIPTS_DIR || path.join(os.homedir(), "Documents", "Transcripts");
const HISTORY_DIR = path.join(TRANSCRIPTS_DIR, "_history");

function slugify(s) {
  const slug = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "transcript";
}

// folder names come from the app (max 40 chars) — make them filesystem-safe
function safeFolderDir(name) {
  const clean = String(name || "")
    .replace(/[/\\:]/g, "-")
    .trim();
  if (!clean || /^\.+$/.test(clean)) return null;
  return clean;
}

function fmEscape(v) {
  // backslashes first (YAML double-quoted scalars treat \ as escape),
  // then quotes; newlines would split the scalar — collapse them
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\s*[\r\n]+\s*/g, " ");
}

// Reads the id from a mirror file's frontmatter.
// true = owned by this note · false = owned by another note · null = no id
// (a legacy file from before ids, or not one of ours)
function fileOwnedBy(rel, id) {
  try {
    const fd = fs.openSync(path.join(TRANSCRIPTS_DIR, rel), "r");
    const buf = Buffer.alloc(500);
    const n = fs.readSync(fd, buf, 0, 500, 0);
    fs.closeSync(fd);
    const m = buf.slice(0, n).toString("utf8").match(/^id: (.+)$/m);
    return m ? m[1].trim() === id : null;
  } catch {
    return false;
  }
}

function dirOf(rel) {
  const d = path.dirname(rel);
  return d === "." ? "" : d;
}

export function buildMarkdown(note) {
  const segments = note.transcript?.segments || [];
  const blocks = toBlocks(segments);
  const chapters = note.chapters || [];

  const items = [];
  let ci = 0;
  for (const b of blocks) {
    while (ci < chapters.length && chapters[ci].start < b.end) {
      items.push({ type: "chapter", ...chapters[ci] });
      ci++;
    }
    items.push({ type: "block", ...b });
  }

  const fm = [
    "---",
    `id: ${note.id}`,
    `title: "${fmEscape(note.title || "Untitled")}"`,
    note.source?.url ? `source: ${note.source.url}` : null,
    note.source?.platform ? `platform: ${note.source.platform}` : null,
    note.source?.uploader ? `creator: "${fmEscape(note.source.uploader)}"` : null,
    note.duration ? `duration: ${formatTimestamp(note.duration)}` : null,
    `saved: ${String(note.createdAt || "").slice(0, 10)}`,
    note.folder ? `folder: "${fmEscape(note.folder)}"` : null,
    note.language ? `language: ${note.language}` : null,
    "app: Transcript Desk",
    "---",
  ].filter(Boolean);

  // AI output uses ## headings of its own — demote them one level so they
  // nest under our section headings
  const demote = (t) => String(t).replace(/^## /gm, "### ");

  const lines = [...fm, "", `# ${note.title || "Transcript"}`, ""];
  if (note.summary?.text) lines.push("## Summary", "", demote(note.summary.text), "");
  if (note.research?.text) lines.push("## Research pack", "", demote(note.research.text), "");
  if (note.translation?.text) lines.push("## Translation", "", note.translation.text, "");
  lines.push("## Transcript", "");
  for (const it of items) {
    if (it.type === "chapter") lines.push(`### ${it.title} — ${formatTimestamp(it.start)}`, "");
    else lines.push(`[${formatTimestamp(it.start)}] ${it.text}`, "");
  }
  return lines.join("\n");
}

// Write/refresh the note's file; relocate it if title or folder changed.
// Returns the path relative to TRANSCRIPTS_DIR, or the existing mdPath when
// there is nothing to write (no transcript yet).
export function syncNoteFile(note) {
  if (!note?.transcript?.segments?.length) return note?.mdPath || null;

  const relDir = safeFolderDir(note.folder) || "";
  fs.mkdirSync(path.join(TRANSCRIPTS_DIR, relDir), { recursive: true });
  const base = slugify(note.title);

  // If the tracked path still fits this note's folder+title, keep it —
  // rewrite in place (recreating it if it was deleted), and never migrate
  // down to a lower suffix. That keeps same-slug notes stable forever.
  if (note.mdPath) {
    const curBase = path.basename(note.mdPath, ".md");
    const fits =
      dirOf(note.mdPath) === relDir && (curBase === base || curBase.startsWith(`${base}-`));
    if (fits && fileOwnedBy(note.mdPath, note.id) !== false) {
      fs.writeFileSync(path.join(TRANSCRIPTS_DIR, note.mdPath), buildMarkdown(note));
      return note.mdPath;
    }
  }

  // Fresh placement (new note, or folder/title changed): claim the first
  // name that is free or verifiably ours — never a file owned by another note.
  let rel = path.join(relDir, `${base}.md`);
  let n = 2;
  for (;;) {
    if (!fs.existsSync(path.join(TRANSCRIPTS_DIR, rel))) break;
    if (fileOwnedBy(rel, note.id) === true) break;
    rel = path.join(relDir, `${base}-${n}.md`);
    n++;
  }

  // moving: remove the old file only if it is (or plausibly is) ours
  if (note.mdPath && note.mdPath !== rel && fileOwnedBy(note.mdPath, note.id) !== false) {
    try {
      fs.rmSync(path.join(TRANSCRIPTS_DIR, note.mdPath));
    } catch {
      /* old file already gone */
    }
  }

  fs.writeFileSync(path.join(TRANSCRIPTS_DIR, rel), buildMarkdown(note));
  return rel;
}

// Deleting a note in the app moves its markdown into _history/ — the
// on-disk record survives.
export function archiveNoteFile(note) {
  if (!note?.mdPath) return;
  const src = path.join(TRANSCRIPTS_DIR, note.mdPath);
  try {
    if (!fs.existsSync(src)) return;
    if (fileOwnedBy(note.mdPath, note.id) === false) return; // another note's file — leave it
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const base = path.basename(note.mdPath, ".md");
    let dest = path.join(HISTORY_DIR, `${base}--deleted-${stamp}.md`);
    let n = 2;
    while (fs.existsSync(dest)) {
      dest = path.join(HISTORY_DIR, `${base}--deleted-${stamp}-${n}.md`);
      n++;
    }
    fs.renameSync(src, dest);
  } catch {
    /* best effort — never block a delete on the mirror */
  }
}
