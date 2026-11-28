import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { NOTES_DIR, MEDIA_DIR, getNote } from "../../../lib/store";
import { TRANSCRIPTS_DIR } from "../../../lib/mdsync";
import { syncMd } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else total += fs.statSync(p).size;
    }
  } catch {
    /* missing */
  }
  return total;
}

function readNotes() {
  const out = [];
  for (const f of fs.readdirSync(NOTES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), "utf8")));
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

// audio pulled for Whisper; once the transcript exists nothing reads it again
function leftoverAudio(notes) {
  const ready = new Set(notes.filter((n) => n.status === "ready" && n.transcript?.segments?.length).map((n) => n.id));
  const files = [];
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    const m = f.match(/^([a-z0-9-]+)\.m4a$/i);
    if (m && ready.has(m[1])) files.push(f);
  }
  return files;
}

export async function GET() {
  const notes = readNotes();
  const folders = {};
  let unsorted = 0;
  for (const n of notes) {
    if (n.folder) folders[n.folder] = (folders[n.folder] || 0) + 1;
    else unsorted++;
  }

  let shotBytes = 0;
  const shotNotes = [];
  for (const n of notes) {
    if (!n.shots?.length) continue;
    for (const s of n.shots) {
      try {
        shotBytes += fs.statSync(path.join(MEDIA_DIR, `${n.id}.${s.file}`)).size;
      } catch {
        /* missing */
      }
    }
    shotNotes.push({ id: n.id, title: n.title, shots: n.shots.map((s) => s.file), createdAt: n.createdAt });
  }
  shotNotes.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const audio = leftoverAudio(notes);
  const audioBytes = audio.reduce((t, f) => t + fs.statSync(path.join(MEDIA_DIR, f)).size, 0);

  return NextResponse.json({
    folders: Object.entries(folders).sort((a, b) => a[0].localeCompare(b[0])),
    unsorted,
    noteCount: notes.length,
    shots: { count: shotNotes.reduce((t, n) => t + n.shots.length, 0), bytes: shotBytes, notes: shotNotes },
    storage: {
      notes: dirSize(NOTES_DIR),
      media: dirSize(MEDIA_DIR),
      transcripts: dirSize(TRANSCRIPTS_DIR),
      transcriptsDir: TRANSCRIPTS_DIR,
      audioFiles: audio.length,
      audioBytes,
    },
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  // opens Finder on the Mac (from the phone it opens on the Mac too)
  if (body.action === "open-transcripts") {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    spawn("/usr/bin/open", [TRANSCRIPTS_DIR], { detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true });
  }

  // rewrite every note's .md in ~/Documents/Transcripts
  if (body.action === "resync") {
    let count = 0;
    for (const n of readNotes()) {
      if (n.status !== "ready") continue;
      syncMd(n.id);
      if (getNote(n.id)?.mdPath) count++;
    }
    return NextResponse.json({ ok: true, count });
  }

  if (body.action === "clear-audio") {
    let freed = 0;
    let count = 0;
    for (const f of leftoverAudio(readNotes())) {
      const p = path.join(MEDIA_DIR, f);
      try {
        freed += fs.statSync(p).size;
        fs.rmSync(p);
        count++;
      } catch {
        /* vanished */
      }
    }
    return NextResponse.json({ ok: true, count, freed });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
