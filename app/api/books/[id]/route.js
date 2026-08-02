import { NextResponse } from "next/server";
import { updateBook, deleteBook } from "../../../../lib/books";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const book = updateBook(id, body);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ book });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  deleteBook(id);
  return NextResponse.json({ ok: true });
}
