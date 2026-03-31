import { loadConfig, saveConfig } from "@/agent/config";
import { upsertRepo } from "@/db/index";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const config = await request.json();
    await saveConfig(config);

    // Sync repos to DB
    for (const repo of config.repos) {
      await upsertRepo({
        name: repo.name,
        aggressiveness: repo.aggressiveness,
        branch: repo.branch,
        installCommand: repo.install_command,
        testCommand: repo.test_command,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
