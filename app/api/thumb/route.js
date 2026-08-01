import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Same-origin image proxy so the ASCII renderer can read thumbnail pixels
// (remote CDNs block canvas access via CORS).
export async function GET(request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) TranscriptDesk/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return NextResponse.json({ error: "fetch failed" }, { status: 502 });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        "content-type": res.headers.get("content-type") || "image/jpeg",
        "cache-control": "public, max-age=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
