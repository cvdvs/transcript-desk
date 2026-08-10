import { NextResponse } from "next/server";
import { listNotes, searchNotes, saveNote, newId } from "../../../lib/store";
import { processUrlNote, repairThumbnails } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request) {
  repairThumbnails(); // re-home any thumbnail whose remote link expired
  const q = new URL(request.url).searchParams.get("q");
  return NextResponse.json({ notes: q?.trim() ? searchNotes(q) : listNotes() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const url = (body.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Please paste a valid link (starting with http)." }, { status: 400 });
  }
  const id = newId();
  saveNote({
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    title: url,
    source: { type: "url", url },
  });
  processUrlNote(id, url);
  return NextResponse.json({ id });
}
