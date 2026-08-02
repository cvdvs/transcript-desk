import { NextResponse } from "next/server";
import { getNote } from "../../../../../lib/store";
import { extractBooksFromNote } from "../../../../../lib/books";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request, { params }) {
  const { id } = await params;
  const note = getNote(id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const result = await extractBooksFromNote(note);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
