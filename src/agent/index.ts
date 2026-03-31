import { loadConfig } from "./config";
import { initDb, upsertRepo } from "../db/index";
import { runPlanJob } from "./jobs/plan-job";
import { runActionJob } from "./jobs/action-job";
import { runReconcileJob } from "./jobs/reconcile-job";

const DRY_RUN = process.argv.includes("--dry-run");

function printUsage(): void {
  console.log(`Usage: tsx src/agent/index.ts <mode> [options]

Modes:
  --plan          Survey repos and build task backlogs
  --action        Execute next pending task from backlogs
  --reconcile     Check open PRs, handle review comments

Options:
  --repo <name>   Target a specific repo (owner/repo)
  --dry-run       Run without creating PRs or modifying state`);
}

async function main(): Promise<void> {
  // Initialize DB and sync repos from config
  await initDb();
  const config = await loadConfig();
  for (const repo of config.repos) {
    await upsertRepo({
      name: repo.name,
      aggressiveness: repo.aggressiveness,
      branch: repo.branch,
      installCommand: repo.install_command,
      testCommand: repo.test_command,
    });
  }

  const repoIdx = process.argv.indexOf("--repo");
  const repoArg = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined;

  if (process.argv.includes("--plan")) {
    await runPlanJob({ repo: repoArg });
    return;
  }
  if (process.argv.includes("--action")) {
    await runActionJob({ repo: repoArg, dryRun: DRY_RUN });
    return;
  }
  if (process.argv.includes("--reconcile")) {
    await runReconcileJob();
    return;
  }

  printUsage();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
