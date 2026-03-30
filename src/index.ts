import { loadConfig } from "./config.js";
import { loadState, saveState } from "./state.js";
import { initBacklog, loadBacklog, addTasks, getNextTask, updateTaskStatus, findTaskByPR } from "./backlog.js";
import { addressComments } from "./agent.js";
import { executeTask } from "./action.js";
import { planRepo } from "./planner.js";
import {
  cloneRepo,
  cleanupRepo,
  createBranch,
  hasChanges,
  commitAndPush,
  createPR,
  ensureLabelExists,
  checkPRStatus,
  getPRComments,
  ensureWorkspace,
  installDeps,
} from "./github.js";
import type { State, TrackedPR, Config } from "./types.js";

const DRY_RUN = process.argv.includes("--dry-run");

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// --- Reconciliation ---

async function reconcileOpenPRs(state: State): Promise<void> {
  const remaining: TrackedPR[] = [];

  for (const pr of state.open_prs) {
    try {
      const status = await checkPRStatus(pr.repo, pr.pr_number);
      if (status.state === "OPEN") {
        pr.last_checked = new Date().toISOString();
        remaining.push(pr);
      } else {
        log(`PR #${pr.pr_number} in ${pr.repo} is ${status.state}, removing from tracking`);
        const task = await findTaskByPR(pr.repo, pr.pr_number);
        if (task) {
          const newStatus = status.state === "MERGED" ? "completed" : "failed";
          await updateTaskStatus(pr.repo, task.id, newStatus);
          log(`Marked task "${task.title}" as ${newStatus}`);
        }
      }
    } catch (err) {
      log(`Failed to check PR #${pr.pr_number} in ${pr.repo}: ${err}`);
      remaining.push(pr);
    }
  }

  state.open_prs = remaining;
}

async function handleReviewComments(state: State, config: Config, costBudget: { remaining: number }): Promise<void> {
  for (const pr of state.open_prs) {
    if (costBudget.remaining <= 0) break;

    try {
      const status = await checkPRStatus(pr.repo, pr.pr_number);
      if (status.state !== "OPEN" || !status.has_new_comments) continue;

      const comments = await getPRComments(pr.repo, pr.pr_number);
      if (comments.length === 0) continue;

      log(`PR #${pr.pr_number} in ${pr.repo} has comments, addressing...`);

      if (DRY_RUN) {
        log(`[DRY RUN] Would address ${comments.length} comments on PR #${pr.pr_number}`);
        continue;
      }

      const repoDir = await cloneRepo(pr.repo);
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const exec = promisify(execFile);
        await exec("git", ["checkout", pr.branch], { cwd: repoDir });

        const repoBackend = config.repos.find((r) => r.name === pr.repo)?.backend ?? config.default_backend;
        const costUsd = await addressComments(repoDir, comments, config, repoBackend);
        costBudget.remaining -= costUsd;

        if (await hasChanges(repoDir)) {
          await commitAndPush(repoDir, pr.branch, "Address review comments");
          log(`Pushed fixes for PR #${pr.pr_number}`);
        }
      } finally {
        await cleanupRepo(repoDir);
      }
    } catch (err) {
      log(`Error handling comments for PR #${pr.pr_number}: ${err}`);
    }
  }
}

// --- Reconcile mode ---

async function runReconcile(): Promise<void> {
  const config = await loadConfig();
  initBacklog(config.planning.backlog_dir);
  const state = await loadState();
  const costBudget = { remaining: config.max_cost_per_run };

  log("Reconciling open PRs...");
  await reconcileOpenPRs(state);
  log(`Tracking ${state.open_prs.length} open PRs`);

  if (state.open_prs.length > 0) {
    log("Checking for review comments...");
    await handleReviewComments(state, config, costBudget);
  }

  await saveState(state);
  log("Reconcile done");
}

// --- Plan mode ---

async function planRepos(): Promise<void> {
  const config = await loadConfig();
  initBacklog(config.planning.backlog_dir);
  const costBudget = { remaining: config.max_cost_per_run };

  const repoIdx = process.argv.indexOf("--repo");
  const repoArg = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined;

  const repos = repoArg
    ? config.repos.filter((r) => r.name === repoArg)
    : config.repos;

  if (repos.length === 0) {
    log(repoArg ? `Repo ${repoArg} not found in config` : "No repos configured");
    return;
  }

  for (const repoConfig of repos) {
    if (costBudget.remaining <= 0) {
      log("Budget exhausted, stopping planning");
      break;
    }

    const backlog = await loadBacklog(repoConfig.name);
    const pending = backlog.tasks.filter((t) => t.status === "pending").length;
    if (pending > 0) {
      log(`${repoConfig.name}: ${pending} existing pending tasks (will find new ones)`);
    }

    log(`Planning ${repoConfig.name} (aggressiveness=${repoConfig.aggressiveness})`);

    const repoDir = await ensureWorkspace(
      repoConfig.name,
      config.planning.workspace_dir,
      repoConfig.branch,
    );

    try {
      const { tasks, costUsd } = await planRepo(repoDir, repoConfig, config, backlog);
      costBudget.remaining -= costUsd;
      log(`Found ${tasks.length} tasks, cost: $${costUsd.toFixed(4)}`);

      if (tasks.length > 0) {
        await addTasks(repoConfig.name, tasks);
        log(`Added ${tasks.length} tasks to backlog for ${repoConfig.name}`);
      } else {
        log(`No tasks found for ${repoConfig.name}`);
      }
    } catch (err) {
      log(`Error planning ${repoConfig.name}: ${err}`);
    }
  }

  log("Planning done");
}

// --- Action mode ---

async function runAction(): Promise<void> {
  const config = await loadConfig();
  initBacklog(config.planning.backlog_dir);
  const state = await loadState();
  const costBudget = { remaining: config.max_cost_per_run };

  const repoIdx = process.argv.indexOf("--repo");
  const repoArg = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined;

  const repos = repoArg
    ? config.repos.filter((r) => r.name === repoArg)
    : config.repos;

  if (repos.length === 0) {
    log(repoArg ? `Repo ${repoArg} not found in config` : "No repos configured");
    return;
  }

  for (const repoConfig of repos) {
    if (costBudget.remaining <= 0) {
      log("Budget exhausted");
      break;
    }

    if (state.open_prs.length >= config.max_open_prs) {
      log(`At PR limit (${state.open_prs.length}/${config.max_open_prs}), stopping`);
      break;
    }

    const backlog = await loadBacklog(repoConfig.name);
    const task = getNextTask(backlog);
    if (!task) {
      log(`${repoConfig.name}: no pending tasks`);
      continue;
    }

    log(`Executing task "${task.title}" for ${repoConfig.name} (backend=${repoConfig.backend})`);
    await updateTaskStatus(repoConfig.name, task.id, "in_progress");

    const repoDir = await cloneRepo(repoConfig.name);
    try {
      const branchName = `janitor/${task.id}`;
      await createBranch(repoDir, branchName);

      // Install dependencies once before subtask loop
      if (repoConfig.install_command) {
        await installDeps(repoDir, repoConfig.install_command);
      }

      // executeTask handles subtask-by-subtask execution + testing
      const { result, costUsd } = await executeTask(task, repoDir, config, repoConfig);
      costBudget.remaining -= costUsd;
      log(`Action cost: $${costUsd.toFixed(4)}, remaining: $${costBudget.remaining.toFixed(4)}`);

      if (!result.has_changes || !(await hasChanges(repoDir))) {
        log(`No changes produced for task "${task.title}", marking skipped`);
        await updateTaskStatus(repoConfig.name, task.id, "skipped");
        continue;
      }

      if (DRY_RUN) {
        log(`[DRY RUN] Would create PR: ${result.pr_title}`);
        log(`Summary:\n${result.summary}`);
        await updateTaskStatus(repoConfig.name, task.id, "pending");
        continue;
      }

      await ensureLabelExists(repoConfig.name);
      await commitAndPush(repoDir, branchName, result.pr_title);
      const prNumber = await createPR(
        repoConfig.name,
        result.pr_title,
        result.pr_body,
        branchName,
        repoConfig.branch,
      );

      await updateTaskStatus(repoConfig.name, task.id, "in_progress", prNumber);
      state.open_prs.push({
        repo: repoConfig.name,
        pr_number: prNumber,
        branch: branchName,
        created_at: new Date().toISOString(),
        last_checked: new Date().toISOString(),
      });

      log(`Created PR #${prNumber} for "${task.title}"`);
    } catch (err) {
      log(`Error executing task "${task.title}": ${err}`);
      await updateTaskStatus(repoConfig.name, task.id, "failed");
    } finally {
      await cleanupRepo(repoDir);
    }
  }

  await saveState(state);
  log("Action done");
}

// --- Entry point ---

function printUsage(): void {
  console.log(`Usage: tsx src/index.ts <mode> [options]

Modes:
  --plan          Survey repos and build task backlogs
  --action        Execute next pending task from backlogs
  --reconcile     Check open PRs, handle review comments

Options:
  --repo <name>   Target a specific repo (owner/repo)
  --dry-run       Run without creating PRs or modifying state`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--plan")) {
    return planRepos();
  }
  if (process.argv.includes("--action")) {
    return runAction();
  }
  if (process.argv.includes("--reconcile")) {
    return runReconcile();
  }

  printUsage();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
