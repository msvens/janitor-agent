/**
 * Seed script: imports existing JSON backlog files and state.json into PostgreSQL.
 * Run once after db:push: npx tsx src/db/seed.ts
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { upsertRepo, addTask, addTrackedPR } from "./index";
import { loadConfig } from "../agent/config";
import type { RepoBacklog, State, BacklogTask, TaskChange } from "../agent/types";

async function seed() {
  console.log("Seeding database...");

  // Load config and sync repos
  const config = await loadConfig();
  for (const repo of config.repos) {
    console.log(`  Syncing repo: ${repo.name}`);
    await upsertRepo({
      name: repo.name,
      aggressiveness: repo.aggressiveness,
      branch: repo.branch,
      installCommand: repo.install_command,
      testCommand: repo.test_command,
    });
  }

  // Import backlogs
  const backlogDir = config.planning.backlog_dir;
  try {
    const files = await readdir(backlogDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const path = join(backlogDir, file);
      console.log(`  Importing backlog: ${file}`);
      try {
        const raw = await readFile(path, "utf-8");
        const backlog = JSON.parse(raw) as any;
        for (const task of backlog.tasks) {
          // Convert old subtasks format to changes format
          const changes: TaskChange[] = (task.subtasks ?? task.changes ?? []).map((s: any) => ({
            file: s.file,
            lines: s.lines ?? (s.line_range ? `${s.line_range[0]}-${s.line_range[1]}` : ""),
            what: s.what,
          }));
          const converted: BacklogTask = {
            id: task.id,
            repo: task.repo,
            title: task.title,
            description: task.description ?? "",
            changes,
            aggressiveness: task.aggressiveness ?? 2,
            status: task.status ?? "pending",
            created_at: task.created_at ?? new Date().toISOString(),
            pr_number: task.pr_number,
          };
          await addTask(converted);
        }
      } catch (err) {
        console.warn(`  Failed to import ${file}: ${(err as Error).message}`);
      }
    }
  } catch {
    console.log("  No backlog directory found, skipping backlog import");
  }

  // Import state.json
  const statePath = resolve(import.meta.dirname, "..", "..", "state.json");
  try {
    const raw = await readFile(statePath, "utf-8");
    const state = JSON.parse(raw) as State;
    for (const pr of state.open_prs) {
      console.log(`  Importing tracked PR: ${pr.repo}#${pr.pr_number}`);
      await addTrackedPR(pr);
    }
  } catch {
    console.log("  No state.json found, skipping state import");
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
