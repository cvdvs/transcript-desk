import { NextResponse } from "next/server";
import { getNote, patchNote, deleteNote } from "../../../../lib/store";
import { syncMd } from "../../../../lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const note = getNote(id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ note });
}

// currently used for folder assignment
export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
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
