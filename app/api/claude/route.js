import { NextResponse } from "next/server";
import { claudeStatus, openLoginTerminal } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json(await claudeStatus());
}

// { action: "login" } opens Terminal on the Mac; { action: "check" } runs a
// real tiny AI call to confirm the sign-in works
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "login") {
    try {
      openLoginTerminal();
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
    }
  }
  if (body.action === "check") {
    return NextResponse.json(await claudeStatus({ probe: true }));
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
