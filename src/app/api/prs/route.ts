import { getTrackedPRs } from "@/db/index";
import { runReconcileJob } from "@/agent/jobs/reconcile-job";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Reconcile before listing — ensures PR statuses are fresh
  try {
    await runReconcileJob();
  } catch {
    // Don't fail the page if reconcile errors — still show cached data
  }

  const prs = await getTrackedPRs();
  return NextResponse.json(prs);
}
