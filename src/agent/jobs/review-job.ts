import { loadConfig } from "../config";
import { selectBackend, getChatFn, maxStepsForBackend, estimateCost, modelForBackend } from "../agent";
import { createReadOnlyTools, type StepTracker } from "../tools";
import { runAgent, type StepInfo } from "../loop";
import { getSettings, getDefaultPrompt, updateJob } from "../../db/index";
import {
  cloneRepo,
  cleanupRepo,
  getPRDiff,
  postPRComment,
} from "../github";

const FALLBACK_REVIEW_PROMPT = `You are a code review agent. You have been asked to review a pull request.

## PR Diff

{{DIFF}}

## Instructions

Review the changes above. You have read-only access to the full repository to understand context.

Focus on:
- **Correctness**: Are there bugs, logic errors, or edge cases?
- **Quality**: Is the code clean, readable, and well-structured?
- **Missing pieces**: Are there missing error handling, tests, or documentation?
- **Suggestions**: Concrete improvements (not stylistic nitpicks)

Write a concise review summary suitable for posting as a PR comment. Use markdown. Be constructive and specific — reference file names and line numbers where relevant.

If the changes look good, explain WHY they look good — what did the author get right? A human reviewer reads your output, so "looks good" alone is not useful. For example: "The extraction of the shared helper avoids the N+1 query that was in the original loop, and the new test covers the empty-list edge case."`;

export interface ReviewJobOptions {
  repo: string;
  prNumber: number;
  jobId?: string;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ReviewJobResult {
  costUsd: number;
}

export async function runReviewJob(options: ReviewJobOptions): Promise<ReviewJobResult> {
  const { repo, prNumber, jobId, onLog, signal } = options;
  const log = onLog ?? ((msg: string) => console.log(`[review] ${msg}`));

  const config = await loadConfig();
  const settings = await getSettings();
  const backend = selectBackend("review", 0, settings);
  const model = modelForBackend(backend, settings);

  log(`Reviewing PR #${prNumber} in ${repo} (backend=${backend}, model=${model})`);

  if (jobId) {
    await updateJob(jobId, { summary: `Review PR #${prNumber} (${repo})` });
  }

  log("Fetching PR diff...");
  const diff = await getPRDiff(repo, prNumber);
  if (!diff.trim()) {
    log("PR diff is empty — nothing to review");
    return { costUsd: 0 };
  }
  log(`Diff: ${diff.split("\n").length} lines`);

  log(`Cloning ${repo}...`);
  const repoDir = await cloneRepo(repo);
  try {
    // Checkout the PR branch
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("gh", ["pr", "checkout", String(prNumber), "--repo", repo], { cwd: repoDir });

    const dbPrompt = await getDefaultPrompt("review");
    const template = dbPrompt?.content ?? FALLBACK_REVIEW_PROMPT;
    const systemPrompt = template.includes("{{DIFF}}")
      ? template.replace("{{DIFF}}", diff.slice(0, 50000))
      : template + "\n\n## PR Diff\n\n" + diff.slice(0, 50000);

    const chatFn = getChatFn(backend, config, settings);
    const maxSteps = maxStepsForBackend(backend, settings);
    const stepTracker: StepTracker = { current: 0, max: maxSteps };
    const tools = createReadOnlyTools(repoDir, stepTracker);
    const stepLogger = makeStepLogger(log);

    const { text, usage, steps } = await runAgent({
      chatFn,
      system: systemPrompt,
      prompt: `Review PR #${prNumber} according to your instructions. Use the tools to read files for context if needed.`,
      tools,
      maxSteps,
      signal,
      onStepFinish: stepLogger,
    });

    log(`Review agent done: ${steps} steps`);
    if (text) {
      log(`Review: ${text.slice(0, 500)}`);
    }

    const costUsd = estimateCost(backend, usage, model);

    if (text.trim()) {
      const comment = `## Review by janitor-agent (${backend}/${model})\n\n${text}`;
      log("Posting review comment...");
      await postPRComment(repo, prNumber, comment);
      log(`Posted review comment on PR #${prNumber}`);
    } else {
      log("Review agent produced no output — skipping comment");
    }

    return { costUsd };
  } finally {
    await cleanupRepo(repoDir);
  }
}

function makeStepLogger(onLog: (msg: string) => void): (step: StepInfo) => void {
  return (step) => {
    for (const tc of step.toolCalls) {
      const args = tc.arguments;
      const summary = args
        ? (args.path ?? args.pattern ?? args.command ?? JSON.stringify(args).slice(0, 80))
        : "[no args]";
      onLog(`Step ${step.stepNumber}: ${tc.name}(${summary})`);
    }
  };
}
