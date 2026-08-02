import { NextResponse } from "next/server";
import { listBooks, addBook, ensureCovers } from "../../../lib/books";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  ensureCovers(); // backfill any missing covers in the background
  return NextResponse.json({ books: listBooks() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const { book, existed } = await addBook({
      title: body.title,
      author: body.author,
      source: body.source,
    });
    return NextResponse.json({ book, existed });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}
