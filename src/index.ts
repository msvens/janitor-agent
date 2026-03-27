import { loadConfig } from "./config.js";
import { loadState, saveState } from "./state.js";
import { initBacklog, loadBacklog, addTasks, needsPlanning, getNextTask, updateTaskStatus, findTaskByPR } from "./backlog.js";
import { analyzeRepo, addressComments } from "./agent.js";
import { executeTask, fixTestFailures } from "./action.js";
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
  runTests,
} from "./github.js";
import type { State, TrackedPR, Config, RepoConfig } from "./types.js";

const DRY_RUN = process.argv.includes("--dry-run");

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function todayBranch(type: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `janitor/${type}-${date}`;
}

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
        // Update backlog task status
        const task = await findTaskByPR(pr.repo, pr.pr_number);
        if (task) {
          const newStatus = status.state === "MERGED" ? "completed" : "failed";
          await updateTaskStatus(pr.repo, task.id, newStatus);
          log(`Marked task "${task.title}" as ${newStatus}`);
        }
      }
    } catch (err) {
      log(`Failed to check PR #${pr.pr_number} in ${pr.repo}: ${err}`);
      remaining.push(pr); // Keep it tracked if we can't check
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
        // Checkout the PR branch
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

function pickNextRepo(config: Config, state: State): typeof config.repos[number] | null {
  // Skip repos that already have an open janitor PR
  const reposWithOpenPRs = new Set(state.open_prs.map((p) => p.repo));

  const candidates = config.repos.filter((r) => !reposWithOpenPRs.has(r.name));
  if (candidates.length === 0) return null;

  // Pick the least recently analyzed
  candidates.sort((a, b) => {
    const aTime = state.repo_history[a.name]?.last_analyzed ?? "1970-01-01T00:00:00Z";
    const bTime = state.repo_history[b.name]?.last_analyzed ?? "1970-01-01T00:00:00Z";
    return aTime.localeCompare(bTime);
  });

  return candidates[0]!;
}

async function analyzeAndCreatePR(
  repoConfig: RepoConfig,
  config: Config,
  state: State,
  costBudget: { remaining: number }
): Promise<void> {
  const { name: repo, aggressiveness, branch } = repoConfig;

  log(`Analyzing ${repo} (aggressiveness=${aggressiveness}, backend=${repoConfig.backend})`);

  const repoDir = await cloneRepo(repo);
  try {
    const branchName = todayBranch("maintenance");
    await createBranch(repoDir, branchName);

    const abortController = new AbortController();

    const { result, costUsd } = await analyzeRepo(repoDir, aggressiveness, config, repoConfig.backend, abortController);
    costBudget.remaining -= costUsd;
    log(`Analysis cost: $${costUsd.toFixed(4)}, remaining budget: $${costBudget.remaining.toFixed(4)}`);

    // Update history regardless of outcome
    state.repo_history[repo] = {
      ...state.repo_history[repo],
      last_analyzed: new Date().toISOString(),
    };

    if (!result.has_changes) {
      log(`No changes needed for ${repo}`);
      return;
    }

    if (!(await hasChanges(repoDir))) {
      log(`Agent reported changes but git shows no diff for ${repo}, skipping`);
      return;
    }

    if (DRY_RUN) {
      log(`[DRY RUN] Would create PR for ${repo}: ${result.pr_title}`);
      log(`Summary:\n${result.summary}`);
      return;
    }

    await ensureLabelExists(repo);
    await commitAndPush(repoDir, branchName, result.pr_title);
    const prNumber = await createPR(repo, result.pr_title, result.pr_body, branchName, branch);

    state.open_prs.push({
      repo,
      pr_number: prNumber,
      branch: branchName,
      created_at: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });

    state.repo_history[repo]!.last_pr_created = new Date().toISOString();
    log(`Created PR #${prNumber} for ${repo}`);
  } finally {
    await cleanupRepo(repoDir);
  }
}

async function planRepos(): Promise<void> {
  const config = await loadConfig();
  initBacklog(config.planning.backlog_dir);
  const costBudget = { remaining: config.max_cost_per_run };

  // Check if a specific repo was requested
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
    // Skip only in automatic mode (future); --plan always runs
    // But still log existing state for visibility
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

      const { result, costUsd } = await executeTask(task, repoDir, config, repoConfig.backend);
      costBudget.remaining -= costUsd;
      log(`Action cost: $${costUsd.toFixed(4)}, remaining: $${costBudget.remaining.toFixed(4)}`);

      if (!result.has_changes || !(await hasChanges(repoDir))) {
        log(`No changes produced for task "${task.title}", marking skipped`);
        await updateTaskStatus(repoConfig.name, task.id, "skipped");
        continue;
      }

      // Test loop
      if (repoConfig.test_command) {
        let testResult = await runTests(repoDir, repoConfig.test_command, repoConfig.install_command);
        let retries = 0;
        const maxRetries = 2;

        while (!testResult.passed && retries < maxRetries) {
          retries++;
          log(`Tests failed (attempt ${retries}/${maxRetries}), asking agent to fix...`);
          const fixCost = await fixTestFailures(testResult.output, repoDir, config, repoConfig.backend);
          costBudget.remaining -= fixCost.costUsd;
          testResult = await runTests(repoDir, repoConfig.test_command, repoConfig.install_command);
        }

        if (!testResult.passed) {
          log(`Tests still failing after ${maxRetries} retries, marking task failed`);
          await updateTaskStatus(repoConfig.name, task.id, "failed");
          continue;
        }
      }

      if (DRY_RUN) {
        log(`[DRY RUN] Would create PR: ${result.pr_title}`);
        log(`Summary:\n${result.summary}`);
        await updateTaskStatus(repoConfig.name, task.id, "pending"); // Reset to pending
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

async function main(): Promise<void> {
  if (process.argv.includes("--plan")) {
    return planRepos();
  }
  if (process.argv.includes("--action")) {
    return runAction();
  }

  log(`Janitor Agent starting${DRY_RUN ? " (DRY RUN)" : ""}`);

  const config = await loadConfig();
  const state = await loadState();
  const costBudget = { remaining: config.max_cost_per_run };

  // Step 1: Reconcile tracked PRs (remove merged/closed)
  log("Reconciling open PRs...");
  await reconcileOpenPRs(state);
  log(`Tracking ${state.open_prs.length} open PRs`);

  // Step 2: Handle review comments on open PRs
  if (state.open_prs.length > 0) {
    log("Checking for review comments...");
    await handleReviewComments(state, config, costBudget);
  }

  // Step 3: Analyze repos if under PR limit
  if (state.open_prs.length < config.max_open_prs && costBudget.remaining > 0) {
    const repo = pickNextRepo(config, state);
    if (repo) {
      try {
        await analyzeAndCreatePR(repo, config, state, costBudget);
      } catch (err) {
        log(`Error analyzing ${repo.name}: ${err}`);
      }
    } else {
      log("No repos eligible for analysis (all have open janitor PRs)");
    }
  } else {
    log(
      costBudget.remaining <= 0
        ? "Budget exhausted, skipping analysis"
        : `At PR limit (${state.open_prs.length}/${config.max_open_prs}), skipping analysis`
    );
  }

  // Step 4: Save state
  await saveState(state);
  log("Done");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
