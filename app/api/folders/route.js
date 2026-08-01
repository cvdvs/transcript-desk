import { NextResponse } from "next/server";
import { renameFolder, removeFolder } from "../../../lib/store";

export const dynamic = "force-dynamic";

function cleanName(v) {
  return String(v ?? "").trim().slice(0, 40);
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));

  if (body.action === "rename") {
    const from = cleanName(body.from);
    const to = cleanName(body.to);
    if (!from || !to) {
      return NextResponse.json({ error: "Folder names can't be empty." }, { status: 400 });
    }
    if (from === to) return NextResponse.json({ ok: true, count: 0 });
    const count = renameFolder(from, to);
    return NextResponse.json({ ok: true, count });
  }

  if (body.action === "remove") {
    const name = cleanName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Folder name can't be empty." }, { status: 400 });
    }
    const count = removeFolder(name);
    return NextResponse.json({ ok: true, count });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
