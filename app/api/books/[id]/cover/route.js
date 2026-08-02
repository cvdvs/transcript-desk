import { NextResponse } from "next/server";
import fs from "node:fs";
import { coverFile } from "../../../../../lib/books";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const buf = fs.readFileSync(coverFile(id));
    return new Response(buf, {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ error: "no cover" }, { status: 404 });
  }
}
