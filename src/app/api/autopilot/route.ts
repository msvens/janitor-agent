import { jobManager } from "@/lib/job-manager";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    active: jobManager.autopilotActive,
    jobRunning: jobManager.isRunning(),
    runningJobId: jobManager.getRunningJobId(),
  });
}

export async function POST(request: NextRequest) {
  const { action } = await request.json();

  if (action === "start") {
    await jobManager.startAutopilot();
    return NextResponse.json({ active: true });
  }

  if (action === "stop") {
    await jobManager.stopAutopilot();
    return NextResponse.json({ active: false });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
