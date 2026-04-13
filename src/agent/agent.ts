import { createClaudeChatFn } from "./backends/claude";
import { createOllamaChatFn } from "./backends/ollama";
import { type ChatFn, type ChatUsage, type StepInfo } from "./loop";
import type { Backend, Config, Settings } from "./types";

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

export const TOOL_USAGE_HINT = `

## Tool Usage

To make changes you MUST call the editFile or writeFile tool — do not just describe changes in text.

WRONG: "I can see there's an unused import, it should be removed"
RIGHT: Call editFile to remove the unused import

Available tools: readFile, writeFile, editFile, glob, grep, bash.
Do NOT use bash for searching files — use the glob and grep tools instead. Save bash for tasks those tools cannot handle.`;

// --- Backend selection ---

export function selectBackend(aggressiveness: number, settings: Settings): Backend {
  if (settings.ollama_enabled && aggressiveness <= settings.ollama_max_aggressiveness) {
    return "ollama";
  }
  return "claude";
}

export function getChatFn(backend: Backend, config: Config, settings: Settings): ChatFn {
  if (backend === "ollama") {
    return createOllamaChatFn({
      enabled: settings.ollama_enabled,
      host: config.ollama.host,
      model: config.ollama.model,
      num_ctx: settings.ollama_num_ctx,
      max_steps: settings.ollama_max_steps,
      max_aggressiveness: settings.ollama_max_aggressiveness,
    });
  }
  return createClaudeChatFn(config.claude.model);
}

export function maxStepsForBackend(backend: Backend, settings: Settings): number {
  return backend === "ollama" ? settings.ollama_max_steps : settings.claude_max_steps;
}

// --- Cost estimation ---

const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-haiku":  [0.80, 4],
  "claude-sonnet": [3, 15],
  "claude-opus":   [15, 75],
};

function getModelPricing(model: string): [number, number] {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix)) return pricing;
  }
  return [3, 15];
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

// --- Logging ---

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
      `[agent] Step ${step.stepNumber}: text (${step.text.length} chars): ${step.text.slice(0, 200)}`,
    );
  }
}

// --- Review comment handling (always Claude) ---

export interface AddressCommentsResult {
  costUsd: number;
  response: string;
  steps: number;
}

export async function addressComments(
  repoPath: string,
  comments: string[],
  config: Config,
  abortController?: AbortController,
): Promise<AddressCommentsResult> {
  const { runAgent } = await import("./loop");
  const { createTools } = await import("./tools");
  const { getDefaultPrompt } = await import("../db/index");

  const chatFn = createClaudeChatFn(config.claude.model);
  const tools = createTools(repoPath);

  const commentBlock = comments
    .map((c, i) => `Comment ${i + 1}:\n${c}`)
    .join("\n\n");

  const dbPrompt = await getDefaultPrompt("review");
  const systemPrompt = dbPrompt?.content ?? `You are a code maintenance agent. A reviewer left comments on your PR. Address them by making the requested changes. If a comment is not actionable (e.g., "looks good"), skip it.`;

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt: commentBlock,
    tools,
    maxSteps: 10,
    signal: abortController?.signal,
  });

  return {
    costUsd: estimateCost("claude", usage, config.claude.model),
    response: text,
    steps,
  };
}

