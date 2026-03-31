import { loadConfig } from "../config";
import { initBacklog, loadBacklog, addTasks } from "../backlog";
import { planRepo } from "../planner";
import { ensureWorkspace } from "../github";
import type { StepInfo } from "../loop";

export interface PlanJobOptions {
  repo?: string;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface PlanJobResult {
  tasksAdded: number;
  costUsd: number;
}

export async function runPlanJob(options: PlanJobOptions = {}): Promise<PlanJobResult> {
  const { repo: repoFilter, onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`));

  const config = await loadConfig();
  await initBacklog(config.planning.backlog_dir);
  const costBudget = { remaining: config.max_cost_per_run };

  const repos = repoFilter
    ? config.repos.filter((r) => r.name === repoFilter)
    : config.repos;

  if (repos.length === 0) {
    log(repoFilter ? `Repo ${repoFilter} not found in config` : "No repos configured");
    return { tasksAdded: 0, costUsd: 0 };
  }

  let totalTasksAdded = 0;
  let totalCost = 0;

  for (const repoConfig of repos) {
    if (signal?.aborted) break;
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
      totalCost += costUsd;
      log(`Found ${tasks.length} tasks, cost: $${costUsd.toFixed(4)}`);

      if (tasks.length > 0) {
        await addTasks(repoConfig.name, tasks);
        totalTasksAdded += tasks.length;
        log(`Added ${tasks.length} tasks to backlog for ${repoConfig.name}`);
      } else {
        log(`No tasks found for ${repoConfig.name}`);
      }
    } catch (err) {
      log(`Error planning ${repoConfig.name}: ${err}`);
    }
  }

  log("Planning done");
  return { tasksAdded: totalTasksAdded, costUsd: totalCost };
}
