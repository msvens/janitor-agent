import { loadConfig } from "../config";
import { loadState, saveState } from "../state";
import { initBacklog, loadBacklog, getNextTask, updateTaskStatus } from "../backlog";
import { executeTask } from "../action";
import {
  cloneRepo,
  cleanupRepo,
  createBranch,
  hasChanges,
  commitAndPush,
  createPR,
  ensureLabelExists,
  installDeps,
} from "../github";

export interface ActionJobOptions {
  repo?: string;
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
  const { repo: repoFilter, dryRun = false, onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`));

  const config = await loadConfig();
  await initBacklog(config.planning.backlog_dir);
  const state = await loadState();
  const costBudget = { remaining: config.max_cost_per_run };

  const repos = repoFilter
    ? config.repos.filter((r) => r.name === repoFilter)
    : config.repos;

  if (repos.length === 0) {
    log(repoFilter ? `Repo ${repoFilter} not found in config` : "No repos configured");
    return { costUsd: 0 };
  }

  let result: ActionJobResult = { costUsd: 0 };

  for (const repoConfig of repos) {
    if (signal?.aborted) break;
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

    log(`Executing task "${task.title}" for ${repoConfig.name}`);
    await updateTaskStatus(repoConfig.name, task.id, "in_progress");

    const repoDir = await cloneRepo(repoConfig.name);
    try {
      const branchName = `janitor/${task.id}`;
      await createBranch(repoDir, branchName);

      if (repoConfig.install_command) {
        await installDeps(repoDir, repoConfig.install_command);
      }

      const { result: taskResult, costUsd } = await executeTask(task, repoDir, config, repoConfig);
      costBudget.remaining -= costUsd;
      result.costUsd += costUsd;
      result.taskTitle = task.title;
      log(`Action cost: $${costUsd.toFixed(4)}, remaining: $${costBudget.remaining.toFixed(4)}`);

      if (!taskResult.has_changes || !(await hasChanges(repoDir))) {
        log(`No changes produced for task "${task.title}", marking skipped`);
        await updateTaskStatus(repoConfig.name, task.id, "skipped");
        continue;
      }

      if (dryRun) {
        log(`[DRY RUN] Would create PR: ${taskResult.pr_title}`);
        log(`Summary:\n${taskResult.summary}`);
        await updateTaskStatus(repoConfig.name, task.id, "pending");
        continue;
      }

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
    } finally {
      await cleanupRepo(repoDir);
    }
  }

  await saveState(state);
  log("Action done");
  return result;
}
