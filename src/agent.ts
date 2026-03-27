import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClaudeChatFn } from "./backends/claude.js";
import { createOllamaChatFn } from "./backends/ollama.js";
import { runAgent, type ChatFn, type ChatUsage, type StepInfo } from "./loop.js";
import { createTools, type StepTracker } from "./tools.js";
import type { AnalysisResult, Backend, Config } from "./types.js";

const PROMPT_PATH = resolve(import.meta.dirname, "..", "prompts", "analyze.md");

export const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: `**Minimal**: Only dependency updates.
- Update outdated packages (check package.json, go.mod, etc.)
- Flag known security vulnerabilities
- Do NOT make any code changes beyond dependency files`,

  2: `**Conservative**: Dependencies + code quality.
- Everything from level 1
- Remove unused imports and variables
- Remove dead code (unreachable code, unused functions)
- Fix obvious lint issues (consistent formatting, trailing whitespace)
- Flag modules that lack test files (mention in summary, but don't create tests)`,

  3: `**Moderate**: Dependencies + quality + minor refactors + basic tests.
- Everything from level 2
- Extract repeated code into shared helpers (only if 3+ occurrences)
- Simplify overly complex conditionals
- Replace deprecated API calls with modern equivalents
- Add tests for untested utility functions and pure logic (match existing test framework and style)`,

  4: `**Active**: All of above + pattern improvements + more tests.
- Everything from level 3
- Improve error handling (add missing error checks, better error messages)
- Use modern language features where they improve readability
- Replace callbacks with async/await where straightforward
- Add integration tests, improve coverage of existing test suites (match repo conventions)`,

  5: `**Aggressive**: All of above + structural suggestions + comprehensive tests.
- Everything from level 4
- Suggest file reorganization (as comments in PR, not actual moves)
- Improve type safety (add missing TypeScript types, reduce use of \`any\`)
- Add edge case tests, improve test helpers, suggest test architecture improvements`,
};

const TOOL_USAGE_HINT = `

## Tool Usage

To make changes you MUST call the editFile or writeFile tool — do not just describe changes in text.

WRONG: "I can see there's an unused import, it should be removed"
RIGHT: Call editFile to remove the unused import

If nothing needs fixing, just output JANITOR_NO_CHANGES. Do not force unnecessary edits.

Available tools: readFile, writeFile, editFile, glob, grep, bash.
Do NOT use bash for searching files — use the glob and grep tools instead. Save bash for tasks those tools cannot handle.`;

function buildStepBudget(maxSteps: number): string {
  const exploreLimit = Math.floor(maxSteps / 3);
  const actionDeadline = Math.floor((maxSteps * 2) / 3);
  return `

## Step Budget — HARD LIMIT: ${maxSteps} steps

You have exactly ${maxSteps} tool calls. Plan accordingly:
- Steps 1-${exploreLimit}: Explore (glob, read key files). Stop exploring after ${exploreLimit} steps.
- Steps ${exploreLimit + 1}-${actionDeadline}: Act (editFile to fix the issue you found).
- Steps ${actionDeadline + 1}-${maxSteps}: Output your summary. You MUST output JANITOR_SUMMARY or JANITOR_NO_CHANGES before step ${maxSteps}.

If you haven't found an issue by step ${exploreLimit}, output JANITOR_NO_CHANGES immediately.
Do NOT spend more than ${exploreLimit} steps exploring — pick the first valid issue and fix it.`;
}

export function buildPrompt(
  aggressiveness: number,
  template: string,
  backend: Backend,
  maxSteps?: number,
): string {
  const levelDesc =
    LEVEL_DESCRIPTIONS[aggressiveness] ?? LEVEL_DESCRIPTIONS[2]!;
  let prompt = template
    .replace("{{LEVEL}}", String(aggressiveness))
    .replace("{{LEVEL_DESCRIPTION}}", levelDesc);

  if (backend === "ollama") {
    prompt += TOOL_USAGE_HINT;
  }

  if (maxSteps) {
    prompt += buildStepBudget(maxSteps);
  }

  return prompt;
}

export function getChatFn(backend: Backend, config: Config): ChatFn {
  if (backend === "ollama") {
    return createOllamaChatFn(config.ollama);
  }
  return createClaudeChatFn(config.claude.model);
}

export function parseResult(text: string): AnalysisResult {
  if (text.includes("JANITOR_NO_CHANGES")) {
    return {
      has_changes: false,
      summary: "No changes needed",
      pr_title: "",
      pr_body: "",
    };
  }

  const summaryMatch = text.match(
    /JANITOR_SUMMARY_START\s*\n([\s\S]*?)JANITOR_SUMMARY_END/,
  );

  if (!summaryMatch) {
    return {
      has_changes: true,
      summary: text.slice(0, 500),
      pr_title: "Automated maintenance improvements",
      pr_body: text.slice(0, 2000),
    };
  }

  const block = summaryMatch[1]!;
  const titleMatch = block.match(/TITLE:\s*(.+)/);
  const changesMatch = block.match(/CHANGES:\s*\n([\s\S]*)/);

  const title =
    titleMatch?.[1]?.trim() ?? "Automated maintenance improvements";
  const changes = changesMatch?.[1]?.trim() ?? block.trim();

  return {
    has_changes: true,
    summary: changes,
    pr_title: title,
    pr_body: `## Janitor Agent - Automated Maintenance\n\n${changes}\n\n---\n*Created by [janitor-agent](https://github.com/msvens/janitor-agent)*`,
  };
}

// Per-1M-token pricing (input/output) by model name prefix
const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-haiku":  [0.80, 4],
  "claude-sonnet": [3, 15],
  "claude-opus":   [15, 75],
};

function getModelPricing(model: string): [number, number] {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix)) return pricing;
  }
  return [3, 15]; // default to Sonnet pricing
}

export function estimateCost(
  backend: Backend,
  usage: ChatUsage,
  model?: string,
): number {
  if (backend === "ollama") return 0;
  const [inputPer1M, outputPer1M] = getModelPricing(model ?? "claude-sonnet");
  return (
    (usage.inputTokens / 1_000_000) * inputPer1M +
    (usage.outputTokens / 1_000_000) * outputPer1M
  );
}

export function logStep(step: StepInfo) {
  if (step.toolCalls.length > 0) {
    for (const tc of step.toolCalls) {
      const args = tc.arguments;
      const summary = args
        ? (args.path ?? args.pattern ?? args.command ?? JSON.stringify(args).slice(0, 80))
        : `[no args]`;
      console.log(`[agent] Step ${step.stepNumber}: ${tc.name}(${summary})`);
    }
    for (const tr of step.toolResults) {
      if (
        tr.output.length === 0 ||
        tr.output.includes("No matches found") ||
        tr.output.includes("No files found") ||
        tr.output.startsWith("Error")
      ) {
        console.log(`[agent]   → ${tr.output.slice(0, 200)}`);
      }
    }
  } else if (step.text) {
    console.log(
      `[agent] Step ${step.stepNumber}: text output (${step.text.length} chars)`,
    );
  }
}

export async function analyzeRepo(
  repoPath: string,
  aggressiveness: number,
  config: Config,
  backend: Backend,
  abortController?: AbortController,
): Promise<{ result: AnalysisResult; costUsd: number }> {
  const template = await readFile(PROMPT_PATH, "utf-8");
  const maxSteps =
    backend === "ollama" ? config.ollama.max_steps : config.claude.max_steps;
  const systemPrompt = buildPrompt(aggressiveness, template, backend, maxSteps);
  const chatFn = getChatFn(backend, config);
  const stepTracker: StepTracker = { current: 0, max: maxSteps };
  const tools = createTools(repoPath, stepTracker);

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt:
      "Analyze this repository and make improvements according to your instructions.",
    tools,
    maxSteps,
    signal: abortController?.signal,
    onStepFinish: logStep,
  });

  console.log(`[agent] Done: ${steps} steps`);
  if (text) {
    console.log(`[agent] Final text (first 300 chars): ${text.slice(0, 300)}`);
  }

  const result = parseResult(text);
  const costUsd = estimateCost(backend, usage, config.claude.model);
  return { result, costUsd };
}

export async function addressComments(
  repoPath: string,
  comments: string[],
  config: Config,
  backend: Backend,
  abortController?: AbortController,
): Promise<number> {
  const chatFn = getChatFn(backend, config);
  const tools = createTools(repoPath);

  const commentBlock = comments
    .map((c, i) => `Comment ${i + 1}:\n${c}`)
    .join("\n\n");

  const systemPrompt = `You are a code maintenance agent. A reviewer left comments on your PR. Address them by making the requested changes. If a comment is not actionable (e.g., "looks good"), skip it.${backend === "ollama" ? TOOL_USAGE_HINT : ""}`;

  const { usage } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt: commentBlock,
    tools,
    maxSteps: 10,
    signal: abortController?.signal,
  });

  return estimateCost(backend, usage, config.claude.model);
}
