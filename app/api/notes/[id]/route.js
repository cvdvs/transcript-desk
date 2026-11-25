import { NextResponse } from "next/server";
import { getNote, patchNote, deleteNote } from "../../../../lib/store";
import path from "node:path";
import { syncMd } from "../../../../lib/pipeline";
import { TRANSCRIPTS_DIR } from "../../../../lib/mdsync";

// absolute paths of the note's mirror files, so you can point Claude at them
function filePaths(note) {
  return {
    md: note.mdPath ? path.join(TRANSCRIPTS_DIR, note.mdPath) : null,
    shots: (note.shots || []).map((s) => path.join(TRANSCRIPTS_DIR, "_attachments", `${note.id}-${s.file}`)),
  };
}

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const note = getNote(id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ note, paths: filePaths(note) });
}

// currently used for folder assignment
export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  // your own notes on a video: how you'll use it + free notes (autosaved)
  if (("intent" in body || "myNotes" in body) && !("folder" in body)) {
    const patch = {};
    if ("intent" in body) patch.intent = String(body.intent ?? "").slice(0, 2000);
    if ("myNotes" in body) patch.myNotes = String(body.myNotes ?? "").slice(0, 100000);
    const note = patchNote(id, patch);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    syncMd(id);
    return NextResponse.json({ note });
  }
  // the done dot: ticks an idea off (used it / wrote about it)
  if ("done" in body && !("folder" in body)) {
    const note = patchNote(id, { done: Boolean(body.done) });
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ note });
  }
  if (!("folder" in body)) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const folder = String(body.folder ?? "").trim().slice(0, 40) || null;
  let note = patchNote(id, { folder });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  syncMd(id); // move the mirror .md into the new folder
  note = getNote(id) || note;
  return NextResponse.json({ note });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  deleteNote(id);
  return NextResponse.json({ ok: true });
}
