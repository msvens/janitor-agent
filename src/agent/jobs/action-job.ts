import { loadConfig } from "../config";
import { loadState, saveState } from "../state";
import { loadBacklog, getNextTask, updateTaskStatus } from "../backlog";
import { getTask, getSettings, getAllRepoConfigs } from "../../db/index";
import { executeTask } from "../action";
import { runReconcileJob } from "./reconcile-job";
import {
  cloneRepo,
  cleanupRepo,
  createBranch,
  hasChanges,
  commitAndPush,
  createPR,
  ensureLabelExists,
  installDeps,
  runTests,
  deleteRemoteBranch,
} from "../github";

export interface ActionJobOptions {
  repo?: string;
  taskId?: string;
  jobId?: string;
  dryRun?: boolean;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ActionJobResult {
  prNumber?: number;
  costUsd: number;
  taskTitle?: string;
}

export async function runActionJob(options: ActionJobOptions = {}): Promise<ActionJobResult> {
  const { repo: repoFilter, taskId: targetTaskId, jobId: currentJobId, dryRun = false, onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`));

  // Always reconcile first to catch merged/closed PRs
  log("Reconciling PRs before action...");
  await runReconcileJob({ onLog: log, signal });

  const config = await loadConfig();
  const settings = await getSettings();
  const state = await loadState();
  const costBudget = { remaining: settings.max_cost_per_run };

  const repos = repoFilter
    ? (await getAllRepoConfigs()).filter((r) => r.name === repoFilter)
    : await getAllRepoConfigs();

  if (repos.length === 0) {
    log(repoFilter ? `Repo ${repoFilter} not found` : "No repos configured");
    return { costUsd: 0 };
  }

  let result: ActionJobResult = { costUsd: 0 };

  for (const repoConfig of repos) {
    if (signal?.aborted) break;
    if (costBudget.remaining <= 0) {
      log("Budget exhausted");
      break;
    }

    if (state.open_prs.length >= settings.max_open_prs) {
      log(`At global PR limit (${state.open_prs.length}/${settings.max_open_prs}), stopping`);
      break;
    }

    // Max 1 open PR per repo — skip repos that already have one
    const repoHasOpenPR = state.open_prs.some((pr) => pr.repo === repoConfig.name);
    if (repoHasOpenPR) {
      log(`${repoConfig.name}: already has an open PR, skipping`);
      continue;
    }

    const task = targetTaskId
      ? await getTask(targetTaskId)
      : getNextTask(await loadBacklog(repoConfig.name));
    if (!task || (targetTaskId && task.repo !== repoConfig.name)) {
      if (!targetTaskId) log(`${repoConfig.name}: no pending tasks`);
      continue;
    }

    log(`Executing task "${task.title}" for ${repoConfig.name}`);
    await updateTaskStatus(repoConfig.name, task.id, "in_progress", undefined, currentJobId);

    log(`Cloning ${repoConfig.name}...`);
    const branchName = `janitor/${task.id}`;
    const repoDir = await cloneRepo(repoConfig.name);
    try {
      await createBranch(repoDir, branchName);

      if (repoConfig.install_command) {
        log(`Installing dependencies...`);
        await installDeps(repoDir, repoConfig.install_command);
      }

      // Baseline check: verify tests pass BEFORE making any changes
      if (repoConfig.test_command) {
        log("Running baseline tests (before changes)...");
        const baseline = await runTests(repoDir, repoConfig.test_command);
        if (!baseline.passed) {
          log(`Baseline tests fail on clean clone — skipping task (not our fault)`);
          log(`Baseline error: ${baseline.output.slice(0, 2000)}`);
          await updateTaskStatus(repoConfig.name, task.id, "pending"); // keep pending, not failed
          continue;
        }
        log("Baseline tests pass");
      }

      const { result: taskResult, costUsd } = await executeTask(task, repoDir, config, settings, repoConfig, log);
      costBudget.remaining -= costUsd;
      result.costUsd += costUsd;
      result.taskTitle = task.title;
      log(`Action cost: $${costUsd.toFixed(4)}, remaining: $${costBudget.remaining.toFixed(4)}`);

      if (!taskResult.has_changes || !(await hasChanges(repoDir))) {
        log(`No changes produced for task "${task.title}", marking skipped`);
        await updateTaskStatus(repoConfig.name, task.id, "skipped");
        await deleteRemoteBranch(repoConfig.name, branchName);
        continue;
      }

      if (dryRun) {
        log(`[DRY RUN] Would create PR: ${taskResult.pr_title}`);
        log(`Summary:\n${taskResult.summary}`);
        await updateTaskStatus(repoConfig.name, task.id, "pending");
        continue;
      }

      log(`Creating PR: ${taskResult.pr_title}`);
      await ensureLabelExists(repoConfig.name);
      await commitAndPush(repoDir, branchName, taskResult.pr_title);
      const prNumber = await createPR(
        repoConfig.name,
        taskResult.pr_title,
        taskResult.pr_body,
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

      result.prNumber = prNumber;
      log(`Created PR #${prNumber} for "${task.title}"`);
    } catch (err) {
      log(`Error executing task "${task.title}": ${err}`);
      await updateTaskStatus(repoConfig.name, task.id, "failed");
      await deleteRemoteBranch(repoConfig.name, branchName);
    } finally {
      await cleanupRepo(repoDir);
    }
  }

  await saveState(state);
  log("Action done");
  return result;
}
