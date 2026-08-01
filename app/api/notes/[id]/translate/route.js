import { NextResponse } from "next/server";
import { generateTranslation } from "../../../../../lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const note = await generateTranslation(id);
    if (!note) {
      return NextResponse.json(
        { error: "Could not translate. Is the transcript ready?" },
        { status: 500 }
      );
    }
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
