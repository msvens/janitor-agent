import { getTrackedPRs } from "@/db/index";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const prs = await getTrackedPRs();
  return NextResponse.json(prs);
}
