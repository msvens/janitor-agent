import { loadConfig } from "../config";
import { loadBacklog, addTasks } from "../backlog";
import { planRepo } from "../planner";
import { ensureWorkspace } from "../github";
import { getSettings, getAllRepoConfigs, getRepoOwnerToken, updateJob } from "../../db/index";
import { runWithToken } from "../auth-context";

export interface PlanJobOptions {
  repo?: string;
  jobId?: string;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface PlanJobResult {
  tasksAdded: number;
  costUsd: number;
}

export async function runPlanJob(options: PlanJobOptions = {}): Promise<PlanJobResult> {
  const { repo: repoFilter, jobId: currentJobId, onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`));

  const config = await loadConfig();
  const settings = await getSettings();
  const costBudget = { remaining: settings.max_cost_per_run };

  const repos = repoFilter
    ? (await getAllRepoConfigs()).filter((r) => r.name === repoFilter)
    : await getAllRepoConfigs();

  if (repos.length === 0) {
    log(repoFilter ? `Repo ${repoFilter} not found` : "No repos configured");
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

    const ownerToken = await getRepoOwnerToken(repoConfig.name);
    if (!ownerToken && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      log(`Skipping ${repoConfig.name}: no owner token stored and no GH_TOKEN fallback set`);
      continue;
    }

    await runWithToken(ownerToken, async () => {
      const backlog = await loadBacklog(repoConfig.name);
      const pending = backlog.tasks.filter((t) => t.status === "pending").length;
      if (pending > 0) {
        log(`${repoConfig.name}: ${pending} existing pending tasks (will find new ones)`);
      }

      const repoDir = await ensureWorkspace(
        repoConfig.name,
        config.workspace_dir.replace("~", process.env.HOME ?? "~"),
        repoConfig.branch,
      );

      try {
        const { tasks, costUsd } = await planRepo(repoDir, repoConfig, config, settings, backlog, log);
        costBudget.remaining -= costUsd;
        totalCost += costUsd;

        if (tasks.length > 0) {
          await addTasks(repoConfig.name, tasks);
          totalTasksAdded += tasks.length;
          log(`Added ${tasks.length} tasks to backlog for ${repoConfig.name}`);
          if (currentJobId) {
            await updateJob(currentJobId, { summary: `Found ${tasks.length} tasks for ${repoConfig.name}` });
          }
        } else {
          log(`No tasks found for ${repoConfig.name}`);
          if (currentJobId) {
            await updateJob(currentJobId, { summary: `No tasks found for ${repoConfig.name}` });
          }
        }
      } catch (err) {
        log(`Error planning ${repoConfig.name}: ${err}`);
      }
    });
  }

  log("Planning done");
  return { tasksAdded: totalTasksAdded, costUsd: totalCost };
}
