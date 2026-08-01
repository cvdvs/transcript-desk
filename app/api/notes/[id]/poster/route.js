import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "../../../../../lib/store";

export const dynamic = "force-dynamic";

// Serves the frame snapshot extracted from an uploaded video file.
export async function GET(request, { params }) {
  const { id } = await params;
  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const p = path.join(MEDIA_DIR, `${id}.poster.jpg`);
  try {
    const buf = fs.readFileSync(p);
    return new Response(buf, {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=604800" },
    });
  } catch {
    return NextResponse.json({ error: "no poster" }, { status: 404 });
  }
}
