import "@/lib/init";
import { getAllPrompts, upsertPrompt } from "@/db/index";
import { requireAdmin } from "@/lib/authz";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const prompts = await getAllPrompts();
  return NextResponse.json(prompts);
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json();
  const { name, type, content, description } = body;

  if (!name || !type || !content) {
    return NextResponse.json({ error: "name, type, and content are required" }, { status: 400 });
  }

  const id = randomUUID();
  await upsertPrompt({ id, name, type, content, description, is_default: false });
  return NextResponse.json({ id }, { status: 201 });
}
