import { NextResponse } from "next/server";
import { patchNote } from "../../../../../lib/store";
import { syncMd } from "../../../../../lib/pipeline";

export const dynamic = "force-dynamic";

// Last-chance save for notes typed right before closing the page
// (sent with navigator.sendBeacon, which can only POST).
export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch = {};
  if (typeof body.intent === "string") patch.intent = body.intent.slice(0, 2000);
  if (typeof body.myNotes === "string") patch.myNotes = body.myNotes.slice(0, 100000);
  if (!Object.keys(patch).length || !patchNote(id, patch)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  syncMd(id);
  return NextResponse.json({ ok: true });
}
