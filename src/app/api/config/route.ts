import { loadConfig } from "@/agent/config";
import {
  getSettings,
  updateSettings,
  getAllRepoConfigs,
  getAllRepoConfigsWithOwners,
  upsertRepo,
  deleteRepo,
  getRepo,
  getUserByGithubId,
} from "@/db/index";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET returns bootstrap config + runtime settings + repos
export async function GET() {
  try {
    const config = await loadConfig();
    const settings = await getSettings();
    const repos = await getAllRepoConfigsWithOwners();
    const env = {
      anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
    };
    return NextResponse.json({ config, settings, repos, env });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT updates runtime settings and/or repos (NOT bootstrap config)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.settings) {
      await updateSettings(body.settings);
    }

    if (body.repos) {
      // Sync repos: upsert provided, delete removed
      const existing = await getAllRepoConfigs();
      const newNames = new Set(body.repos.map((r: any) => r.name));

      // Delete repos not in the new list
      for (const repo of existing) {
        if (!newNames.has(repo.name)) {
          await deleteRepo(repo.name);
        }
      }

      // Identify the current user so new repos are attributed to them.
      const session = await auth();
      const githubId = session?.user?.githubId;
      const currentUser = githubId ? await getUserByGithubId(githubId) : null;

      // Upsert all provided repos
      for (const repo of body.repos) {
        const existingRow = await getRepo(repo.name);
        // Only set addedByUserId on insert (new repos). Don't reassign ownership on update.
        const addedByUserId =
          existingRow == null && currentUser ? currentUser.id : undefined;
        await upsertRepo({
          name: repo.name,
          aggressiveness: repo.aggressiveness ?? 2,
          branch: repo.branch ?? "main",
          installCommand: repo.install_command,
          testCommand: repo.test_command,
          planPromptId: repo.plan_prompt_id || null,
          actionPromptId: repo.action_prompt_id || null,
          addedByUserId,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
