import { loadConfig } from "../config";
import { loadState, saveState } from "../state";
import { findTaskByPR, updateTaskStatus } from "../backlog";
import { addressComments } from "../agent";
import { getSettings } from "../../db/index";
import {
  cloneRepo,
  cleanupRepo,
  hasChanges,
  commitAndPush,
  checkPRStatus,
  getPRComments,
  deleteRemoteBranch,
} from "../github";
import type { TrackedPR } from "../types";

export interface ReconcileJobOptions {
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ReconcileJobResult {
  reconciled: number;
  commentsHandled: number;
  costUsd: number;
}

export async function runReconcileJob(options: ReconcileJobOptions = {}): Promise<ReconcileJobResult> {
  const { onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`));

  const config = await loadConfig();
  const settings = await getSettings();
  const state = await loadState();
  const costBudget = { remaining: settings.max_cost_per_run };

  let reconciled = 0;
  let commentsHandled = 0;
  let totalCost = 0;

  log("Reconciling open PRs...");
  const remaining: TrackedPR[] = [];

  for (const pr of state.open_prs) {
    if (signal?.aborted) break;
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
        // Clean up remote branch (don't rely on repo's auto-delete setting)
        await deleteRemoteBranch(pr.repo, pr.branch);
        reconciled++;
      }
    } catch (err) {
      log(`Failed to check PR #${pr.pr_number} in ${pr.repo}: ${err}`);
      remaining.push(pr);
    }
  }

  state.open_prs = remaining;
  log(`Tracking ${state.open_prs.length} open PRs`);

  if (state.open_prs.length > 0) {
    log("Checking for review comments...");
    for (const pr of state.open_prs) {
      if (signal?.aborted) break;
      if (costBudget.remaining <= 0) break;

      try {
        const status = await checkPRStatus(pr.repo, pr.pr_number);
        if (status.state !== "OPEN" || !status.has_new_comments) continue;

        const comments = await getPRComments(pr.repo, pr.pr_number);
        if (comments.length === 0) continue;

        log(`PR #${pr.pr_number} in ${pr.repo} has comments, addressing...`);

        const repoDir = await cloneRepo(pr.repo);
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          await exec("git", ["checkout", pr.branch], { cwd: repoDir });

          const costUsd = await addressComments(repoDir, comments, config);
          costBudget.remaining -= costUsd;
          totalCost += costUsd;

          if (await hasChanges(repoDir)) {
            await commitAndPush(repoDir, pr.branch, "Address review comments");
            log(`Pushed fixes for PR #${pr.pr_number}`);
            commentsHandled++;
          }
        } finally {
          await cleanupRepo(repoDir);
        }
      } catch (err) {
        log(`Error handling comments for PR #${pr.pr_number}: ${err}`);
      }
    }
  }

  await saveState(state);
  log("Reconcile done");
  return { reconciled, commentsHandled, costUsd: totalCost };
}
