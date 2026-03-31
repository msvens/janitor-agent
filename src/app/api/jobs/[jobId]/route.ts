import { getJob } from "@/db/index";
import { jobManager } from "@/lib/job-manager";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const logs = jobManager.getLogs(jobId);
  return NextResponse.json({ ...job, logs });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const aborted = jobManager.abortJob(jobId);
  if (!aborted) {
    return NextResponse.json({ error: "Job not found or not running" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, message: "Job abort signal sent" });
}
