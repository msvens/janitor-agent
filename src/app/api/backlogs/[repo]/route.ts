import { getTasksForRepo } from "@/db/index";
import { NextRequest, NextResponse } from "next/server";
import type { TaskStatus } from "@/agent/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ repo: string }> },
) {
  const { repo } = await params;
  const repoName = decodeURIComponent(repo).replace("-", "/");
  const status = request.nextUrl.searchParams.get("status") as TaskStatus | null;
  const tasks = await getTasksForRepo(repoName, status ?? undefined);
  return NextResponse.json(tasks);
}
