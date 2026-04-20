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

const FALLBACK_REVIEW_PROMPT = `You are a code review agent. A human reviewer is counting on you to catch issues they might miss.

## Changed files

{{CHANGED_FILES}}

## Your process — follow these steps IN ORDER

1. Read each changed file listed above using the readFile tool. You MUST do this before writing anything.
2. For any function that was modified or removed, grep for its name to find callers. Are they updated correctly?
3. Look for test files related to the changed code. Are there tests? Do they cover the changes?
4. Only after completing steps 1-3, write your review.

## Review format

Do NOT summarize the diff — the reviewer can already see what changed. Instead provide:

- **Correctness**: Bugs, logic errors, or edge cases the changes introduce
- **Impact analysis**: What callers or dependents are affected? Any broken contracts?
- **Missing pieces**: Missing error handling, tests, or documentation
- **Verdict**: Does this PR look correct and safe to merge? Explain WHY.

Be specific — reference file names and line numbers. If the changes are solid, explain what makes them correct (e.g., "removing the unused ResponseWriter param is safe because the handler writes responses via the apiResponse helper at line 42, not directly").`;

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
    // Fetch and checkout the PR branch (can't use gh pr checkout on a shallow clone)
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    const { stdout: prJson } = await exec("gh", [
      "pr", "view", String(prNumber), "--repo", repo, "--json", "headRefName",
    ]);
    const branchName = JSON.parse(prJson).headRefName;
    await exec("git", ["fetch", "origin", branchName], { cwd: repoDir });
    await exec("git", ["checkout", "-b", branchName, "FETCH_HEAD"], { cwd: repoDir });

    const changedFiles = extractChangedFiles(diff);
    log(`Changed files: ${changedFiles.join(", ")}`);

    const dbPrompt = await getDefaultPrompt("review");
    const template = dbPrompt?.content ?? FALLBACK_REVIEW_PROMPT;
    const systemPrompt = template.replace("{{CHANGED_FILES}}", changedFiles.map((f) => `- ${f}`).join("\n"));

    const chatFn = getChatFn(backend, config, settings);
    const maxSteps = maxStepsForBackend(backend, settings);
    const stepTracker: StepTracker = { current: 0, max: maxSteps };
    const tools = createReadOnlyTools(repoDir, stepTracker);
    const stepLogger = makeStepLogger(log);

    const userPrompt = [
      `Review PR #${prNumber}. Start by reading the changed files listed in your instructions.`,
      "",
      "Here is the diff for reference:",
      "```diff",
      diff.slice(0, 50000),
      "```",
    ].join("\n");

    const { text, usage, steps } = await runAgent({
      chatFn,
      system: systemPrompt,
      prompt: userPrompt,
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

function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\//);
    if (match) files.add(match[1]!);
  }
  return [...files];
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
