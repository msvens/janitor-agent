import "@/lib/init";
import { getPrompt, upsertPrompt, deletePrompt } from "@/db/index";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(prompt);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  await upsertPrompt({ id, ...body });
  const updated = await getPrompt(id);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (prompt?.is_default) {
    return NextResponse.json({ error: "Cannot delete default prompts" }, { status: 400 });
  }
  await deletePrompt(id);
  return NextResponse.json({ ok: true });
}
