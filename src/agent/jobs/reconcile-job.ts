import { loadConfig } from "../config";
import { loadState, saveState } from "../state";
import { findTaskByPR, updateTaskStatus } from "../backlog";
import { addressComments, estimateCost, modelForBackend, selectBackend } from "../agent";
import { fixTestFailures } from "../action";
import { getSettings, getRepoConfig, updatePRStatus, updateJob } from "../../db/index";
import {
  cloneRepo,
  cleanupRepo,
  hasChanges,
  commitAndPush,
  checkPRStatus,
  getPRComments,
  deleteRemoteBranch,
  installDeps,
  runTests,
  postPRComment,
  getPRCloseReason,
} from "../github";
import type { TrackedPR } from "../types";

export interface ReconcileJobOptions {
  jobId?: string;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ReconcileJobResult {
  reconciled: number;
  commentsHandled: number;
  costUsd: number;
}

export async function runReconcileJob(options: ReconcileJobOptions = {}): Promise<ReconcileJobResult> {
  const { jobId: currentJobId, onLog, signal } = options;
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
        const prStatus = status.state === "MERGED" ? "merged" : "closed";
        log(`PR #${pr.pr_number} in ${pr.repo} is ${status.state}`);
        // Capture close reason from the last comment on the PR
        let closeReason: string | undefined;
        if (prStatus === "closed") {
          closeReason = await getPRCloseReason(pr.repo, pr.pr_number);
          if (closeReason) log(`Close reason: ${closeReason.slice(0, 200)}`);
        }
        await updatePRStatus(pr.repo, pr.pr_number, prStatus, closeReason);
        const task = await findTaskByPR(pr.repo, pr.pr_number);
        if (task) {
          const taskStatus = status.state === "MERGED" ? "completed" : "failed";
          await updateTaskStatus(pr.repo, task.id, taskStatus);
          log(`Marked task "${task.title}" as ${taskStatus}`);
        }
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

        const allComments = await getPRComments(pr.repo, pr.pr_number);
        // Filter out the janitor's own review comments to avoid addressing our own feedback
        const comments = allComments.filter((c) => !c.startsWith("## Review by janitor-agent"));
        if (comments.length === 0) continue;

        log(`PR #${pr.pr_number} in ${pr.repo} has ${comments.length} comment(s), addressing...`);
        for (const c of comments) {
          log(`  Comment: ${c.slice(0, 200)}`);
        }

        const repoDir = await cloneRepo(pr.repo);
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const exec = promisify(execFile);
          await exec("git", ["fetch", "origin", pr.branch], { cwd: repoDir });
          await exec("git", ["checkout", "-b", pr.branch, "FETCH_HEAD"], { cwd: repoDir });

          // Install deps if configured
          const repoConfig = await getRepoConfig(pr.repo);
          if (repoConfig?.install_command) {
            log(`Installing dependencies...`);
            await installDeps(repoDir, repoConfig.install_command);
          }

          const result = await addressComments(repoDir, comments, config, settings);
          costBudget.remaining -= result.costUsd;
          totalCost += result.costUsd;

          log(`Agent done: ${result.steps} steps, cost: $${result.costUsd.toFixed(4)}`);
          if (result.response) {
            log(`Response: ${result.response.slice(0, 500)}`);
          }

          if (await hasChanges(repoDir)) {
            // Run tests before pushing; retry-fix loop mirrors action-job
            if (repoConfig?.test_command) {
              log(`Running tests...`);
              let testResult = await runTests(repoDir, repoConfig.test_command);

              if (!testResult.passed) {
                const maxFixAttempts = 3;
                let fixed = false;
                for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
                  log(`Tests failed, asking Claude to fix (attempt ${attempt}/${maxFixAttempts})...`);
                  log(`Test output: ${testResult.output.slice(0, 1000)}`);

                  const fixResult = await fixTestFailures(testResult.output, repoDir, config, settings, log);
                  const fixBackend = selectBackend("fix", 0, settings);
                  const fixCost = estimateCost(fixBackend, fixResult.usage, modelForBackend(fixBackend, settings));
                  costBudget.remaining -= fixCost;
                  totalCost += fixCost;
                  log(`Fix attempt cost: $${fixCost.toFixed(4)}`);

                  testResult = await runTests(repoDir, repoConfig.test_command);
                  if (testResult.passed) {
                    log(`Tests pass after fix (attempt ${attempt})`);
                    fixed = true;
                    break;
                  }
                }

                if (!fixed) {
                  log(`Tests still failing after ${maxFixAttempts} fix attempts — leaving PR open with comment`);
                  const commentBody = [
                    "Attempted to address review feedback but could not keep tests passing after 3 fix attempts.",
                    "",
                    "Leaving this PR open for human review — feel free to add another comment with guidance, fix manually, or close.",
                    "",
                    "Test output:",
                    "```",
                    testResult.output.slice(0, 3000),
                    "```",
                  ].join("\n");
                  try {
                    await postPRComment(pr.repo, pr.pr_number, commentBody);
                  } catch (err) {
                    log(`Failed to post PR comment: ${err}`);
                  }
                  continue;
                }
              } else {
                log(`Tests pass`);
              }
            }

            await commitAndPush(repoDir, pr.branch, "Address review comments");
            log(`Pushed fixes for PR #${pr.pr_number}`);
            commentsHandled++;
          } else {
            log(`No new changes needed for PR #${pr.pr_number}`);
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

  if (currentJobId) {
    const parts = [];
    if (reconciled > 0) parts.push(`${reconciled} PR${reconciled > 1 ? "s" : ""} resolved`);
    if (commentsHandled > 0) parts.push(`${commentsHandled} comment${commentsHandled > 1 ? "s" : ""} handled`);
    if (parts.length === 0) parts.push(`Checked ${state.open_prs.length} open PRs`);
    await updateJob(currentJobId, { summary: parts.join(", ") });
  }

  log("Reconcile done");
  return { reconciled, commentsHandled, costUsd: totalCost };
}
