/**
 * Seed script: imports existing JSON backlog files into PostgreSQL.
 * Run once after db:push: npx tsx src/db/seed.ts
 *
 * Repos must be added through the UI. This only imports task backlogs.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { addTask } from "./index";
import type { BacklogTask, TaskChange } from "../agent/types";

const BACKLOG_DIR = join(homedir(), ".janitor", "backlog");

async function seed() {
  console.log("Seeding database from JSON backlogs...");

  try {
    const files = await readdir(BACKLOG_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const path = join(BACKLOG_DIR, file);
      console.log(`  Importing: ${file}`);
      try {
        const raw = await readFile(path, "utf-8");
        const backlog = JSON.parse(raw) as any;
        for (const task of backlog.tasks ?? []) {
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
        console.warn(`  Failed: ${(err as Error).message}`);
      }
    }
  } catch {
    console.log("  No backlog directory found at", BACKLOG_DIR);
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
