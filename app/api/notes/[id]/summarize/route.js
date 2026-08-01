import { NextResponse } from "next/server";
import { summarize, generateChapters, syncMd } from "../../../../../lib/pipeline";
import { getNote } from "../../../../../lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// (Re)runs the summary + chapters for an existing note — used to backfill
// notes transcribed before the claude CLI was logged in.
export async function POST(request, { params }) {
  const { id } = await params;
  try {
    await summarize(id);
    await generateChapters(id);
    syncMd(id);
    const note = getNote(id);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
