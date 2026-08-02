import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { MEDIA_DIR, saveNote, newId } from "../../../../lib/store";
import { processFileNote, processImageNote } from "../../../../lib/pipeline";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".tiff", ".gif", ".bmp"]);

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That file is over 2 GB — trim or compress it first." },
      { status: 413 }
    );
  }

  const id = newId();
  const ext = (path.extname(file.name || "") || ".bin").toLowerCase();
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const filePath = path.join(MEDIA_DIR, `${id}.orig${ext}`);
  // stream to disk instead of holding a second full copy in memory
  await streamPipeline(Readable.fromWeb(file.stream()), fs.createWriteStream(filePath));

  const isImage = IMAGE_EXTS.has(ext);
  saveNote({
    id,
    createdAt: new Date().toISOString(),
    status: "queued",
    title: file.name || "Uploaded file",
    source: { type: "file", platform: isImage ? "image" : "local file", originalFilename: file.name },
  });
  if (isImage) processImageNote(id, filePath, file.name || "Uploaded image");
  else processFileNote(id, filePath, file.name || "Uploaded file");
  return NextResponse.json({ id });
}
