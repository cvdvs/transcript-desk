import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR, getNote, patchNote } from "../../../../../../lib/store";
import { syncMd } from "../../../../../../lib/pipeline";

export const dynamic = "force-dynamic";

function resolve(id, file) {
  if (!/^[a-z0-9-]+$/i.test(id) || !/^shot-[a-z0-9]+\.jpg$/i.test(file)) return null;
  return path.join(MEDIA_DIR, `${id}.${file}`);
}

export async function GET(request, { params }) {
  const { id, file } = await params;
  const p = resolve(id, file);
  if (!p) return NextResponse.json({ error: "bad name" }, { status: 400 });
  try {
    return new Response(fs.readFileSync(p), {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(request, { params }) {
  const { id, file } = await params;
  const p = resolve(id, file);
  if (!p) return NextResponse.json({ error: "bad name" }, { status: 400 });
  const note = getNote(id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    fs.rmSync(p);
  } catch {
    /* already gone */
  }
  const saved = patchNote(id, { shots: (note.shots || []).filter((s) => s.file !== file) });
  syncMd(id);
  return NextResponse.json({ note: saved });
}
