import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTools, type StepTracker } from "./tools.js";
import { getChatFn, estimateCost, logStep, parseResult } from "./agent.js";
import { runAgent } from "./loop.js";
import type { AnalysisResult, BacklogTask, Backend, Config } from "./types.js";

const ACTION_PROMPT_PATH = resolve(import.meta.dirname, "..", "prompts", "action.md");
const FIX_PROMPT = `Your previous changes broke the tests. Here is the test output:

{{TEST_OUTPUT}}

Fix your changes so the tests pass. Use readFile to check the current state of files, then use editFile to fix the issues. Do not undo your maintenance changes — adjust them so the tests pass.`;

function formatSubtasks(task: BacklogTask): string {
  return task.subtasks
    .map(
      (st, i) =>
        `${i + 1}. **${st.file}** (lines ${st.line_range[0]}-${st.line_range[1]})\n   - **What**: ${st.what}\n   - **Why**: ${st.why}`,
    )
    .join("\n\n");
}

function buildActionPrompt(template: string, task: BacklogTask): string {
  return template
    .replace(/\{\{TASK_TITLE\}\}/g, task.title)
    .replace("{{TASK_DESCRIPTION}}", task.description)
    .replace("{{SUBTASKS}}", formatSubtasks(task));
}

export async function executeTask(
  task: BacklogTask,
  repoPath: string,
  config: Config,
  backend: Backend,
): Promise<{ result: AnalysisResult; costUsd: number }> {
  const template = await readFile(ACTION_PROMPT_PATH, "utf-8");
  const systemPrompt = buildActionPrompt(template, task);
  const chatFn = getChatFn(backend, config);
  const maxSteps =
    backend === "ollama" ? config.ollama.max_steps : config.claude.max_steps;
  const stepTracker: StepTracker = { current: 0, max: maxSteps };
  const tools = createTools(repoPath, stepTracker);

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt: "Execute the maintenance task according to your instructions.",
    tools,
    maxSteps,
    onStepFinish: logStep,
  });

  console.log(`[action] Done: ${steps} steps`);
  if (text) {
    console.log(`[action] Final text (first 300 chars): ${text.slice(0, 300)}`);
  }

  const result = parseResult(text);
  const costUsd = estimateCost(backend, usage, config.claude.model);
  return { result, costUsd };
}

export async function fixTestFailures(
  testOutput: string,
  repoPath: string,
  config: Config,
  backend: Backend,
): Promise<{ costUsd: number }> {
  const prompt = FIX_PROMPT.replace("{{TEST_OUTPUT}}", testOutput.slice(0, 5000));
  const chatFn = getChatFn(backend, config);
  const tools = createTools(repoPath);

  const { usage } = await runAgent({
    chatFn,
    system: prompt,
    prompt: "Fix the test failures described above.",
    tools,
    maxSteps: 10,
    onStepFinish: logStep,
  });

  return { costUsd: estimateCost(backend, usage, config.claude.model) };
}
