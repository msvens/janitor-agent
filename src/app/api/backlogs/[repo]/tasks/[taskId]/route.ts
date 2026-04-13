import { getTask, updateTaskStatus, deleteTask } from "@/db/index";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ repo: string; taskId: string }> },
) {
  const { taskId } = await params;
  const task = await getTask(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json(task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ repo: string; taskId: string }> },
) {
  const { taskId } = await params;
  const body = await request.json();

  const task = await getTask(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (body.status) {
    await updateTaskStatus(taskId, body.status, body.pr_number, undefined, body.skip_reason);
  }

  const updated = await getTask(taskId);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ repo: string; taskId: string }> },
) {
  const { taskId } = await params;
  await deleteTask(taskId);
  return NextResponse.json({ ok: true });
}
