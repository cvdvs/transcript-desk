import { NextResponse } from "next/server";
import { generateResearchPack } from "../../../../../lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const note = await generateResearchPack(id);
    if (!note) {
      return NextResponse.json(
        { error: "Could not generate the research pack. Is the transcript ready?" },
        { status: 500 }
      );
    }
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
