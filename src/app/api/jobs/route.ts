import { listJobs } from "@/db/index";
import { jobManager } from "@/lib/job-manager";
import type { JobType } from "@/lib/job-manager";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await listJobs();
  const runningId = jobManager.getRunningJobId();
  return NextResponse.json({ jobs, runningJobId: runningId });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, repo } = body as { type: JobType; repo?: string };

  if (!["plan", "action", "reconcile"].includes(type)) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  if (jobManager.isRunning()) {
    return NextResponse.json(
      { error: "A job is already running", runningJobId: jobManager.getRunningJobId() },
      { status: 409 },
    );
  }

  try {
    const jobId = await jobManager.startJob(type, repo);
    return NextResponse.json({ jobId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
