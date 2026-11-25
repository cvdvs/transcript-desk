import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MEDIA_DIR, getNote, patchNote } from "../../../../../lib/store";
import { syncMd } from "../../../../../lib/pipeline";

export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

// Upload one or more screenshots to a note. Each is converted to a jpg
// (macOS `sips` reads HEIC from the iPhone too) and capped at 1800px.
export async function POST(request, { params }) {
  const { id } = await params;
  if (!getNote(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const files = form ? form.getAll("file").filter((f) => f && typeof f !== "string") : [];
  if (!files.length) return NextResponse.json({ error: "No image received." }, { status: 400 });

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const added = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) continue;
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ext = (path.extname(file.name || "") || ".png").toLowerCase().replace(/[^.a-z0-9]/g, "");
    const raw = path.join(MEDIA_DIR, `${id}.shotraw-${stamp}${ext}`);
    const name = `shot-${stamp}.jpg`;
    const dest = path.join(MEDIA_DIR, `${id}.${name}`);
    fs.writeFileSync(raw, Buffer.from(await file.arrayBuffer()));
    spawnSync("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", "1800", raw, "--out", dest], { timeout: 60000 });
    try {
      fs.rmSync(raw);
    } catch {
      /* gone */
    }
    if (fs.existsSync(dest)) added.push({ file: name, createdAt: new Date().toISOString() });
  }
  if (!added.length) {
    return NextResponse.json({ error: "Couldn't read that image." }, { status: 400 });
  }
  const note = getNote(id);
  const saved = patchNote(id, { shots: [...(note.shots || []), ...added] });
  syncMd(id);
  return NextResponse.json({ note: saved });
}
