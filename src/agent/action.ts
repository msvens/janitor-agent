import { createTools } from "./tools";
import { selectBackend, getChatFn, maxStepsForBackend, estimateCost, logStep, TOOL_USAGE_HINT } from "./agent";
import { runAgent, type ChatUsage } from "./loop";
import { runTests } from "./github";
import type { AnalysisResult, BacklogTask, Subtask, Config, RepoConfig } from "./types";

const SUBTASK_PROMPT = `You are a code maintenance agent. Make exactly ONE change to a file.

## Task: {{TASK_TITLE}}

## Your assignment

**File**: {{FILE}}
**Lines**: {{LINE_RANGE}}
**What**: {{WHAT}}
**Why**: {{WHY}}

## Instructions

1. Read the file to find the relevant code (line numbers are approximate)
2. Make the edit using editFile
3. Do NOT change anything else in the file
4. Do NOT explore other files — focus only on this one change`;

const FIX_PROMPT = `You are a code maintenance agent. Your previous edit to **{{FILE}}** broke the build/tests.

## What was changed

File: {{FILE}}
Change: {{WHAT}}

## Build/test output

{{TEST_OUTPUT}}

## Instructions — you have only 10 steps, do NOT waste them

1. The error is almost certainly in **{{FILE}}** — read that file first
2. Look at the error output above to find the exact line and error message
3. Use editFile to fix the issue (typically: syntax error, missing import, wrong function signature)
4. Do NOT read other files, run git commands, or explore the repo
5. Do NOT undo the change — fix it so it compiles correctly`;

function buildSubtaskPrompt(task: BacklogTask, subtask: Subtask, isOllama: boolean): string {
  let prompt = SUBTASK_PROMPT
    .replace("{{TASK_TITLE}}", task.title)
    .replace("{{FILE}}", subtask.file)
    .replace("{{LINE_RANGE}}", `${subtask.line_range[0]}-${subtask.line_range[1]}`)
    .replace("{{WHAT}}", subtask.what)
    .replace("{{WHY}}", subtask.why);

  if (isOllama) {
    prompt += TOOL_USAGE_HINT;
  }

  return prompt;
}

export async function executeTask(
  task: BacklogTask,
  repoPath: string,
  config: Config,
  repoConfig: RepoConfig,
): Promise<{ result: AnalysisResult; costUsd: number }> {
  const backend = selectBackend(task.aggressiveness, config);
  const chatFn = getChatFn(backend, config);
  const maxSteps = maxStepsForBackend(backend, config);

  const ollamaUsage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
  const claudeUsage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
  const completedSubtasks: string[] = [];
  let testsFailing = false;

  console.log(`[action] Task: "${task.title}" — ${task.subtasks.length} subtasks (backend=${backend})`);

  for (let i = 0; i < task.subtasks.length; i++) {
    const subtask = task.subtasks[i]!;
    const label = `[action] [${i + 1}/${task.subtasks.length}]`;
    console.log(`${label} ${subtask.file} — ${subtask.what.slice(0, 80)}`);

    const tools = createTools(repoPath);
    const systemPrompt = buildSubtaskPrompt(task, subtask, backend === "ollama");

    try {
      const { usage, steps } = await runAgent({
        chatFn,
        system: systemPrompt,
        prompt: `Make the change to ${subtask.file} as described above.`,
        tools,
        maxSteps,
        onStepFinish: logStep,
      });

      const usageBucket = backend === "ollama" ? ollamaUsage : claudeUsage;
      usageBucket.inputTokens += usage.inputTokens;
      usageBucket.outputTokens += usage.outputTokens;
      console.log(`${label} Done in ${steps} steps`);
    } catch (err) {
      console.error(`${label} Failed: ${(err as Error).message}`);
      continue;
    }

    // Test after each subtask
    if (repoConfig.test_command) {
      console.log(`${label} Running tests...`);
      let testResult = await runTests(repoPath, repoConfig.test_command);

      if (!testResult.passed) {
        const maxFixAttempts = 3;
        let fixed = false;

        for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
          console.log(`${label} Tests failed, asking Claude to fix (attempt ${attempt}/${maxFixAttempts})...`);
          console.log(`${label} Test output (first 500 chars): ${testResult.output.slice(0, 500)}`);
          const fixResult = await fixTestFailures(testResult.output, repoPath, config, subtask.file, subtask.what);
          claudeUsage.inputTokens += fixResult.usage.inputTokens;
          claudeUsage.outputTokens += fixResult.usage.outputTokens;

          testResult = await runTests(repoPath, repoConfig.test_command);
          if (testResult.passed) {
            console.log(`${label} Tests pass after fix (attempt ${attempt})`);
            fixed = true;
            break;
          }
        }

        if (!fixed) {
          console.error(`${label} Tests still failing after ${maxFixAttempts} fix attempts — stopping`);
          testsFailing = true;
          break;
        }
      } else {
        console.log(`${label} Tests pass`);
      }
    }

    completedSubtasks.push(`- ${subtask.file}: ${subtask.what}`);
  }

  console.log(`[action] Completed ${completedSubtasks.length}/${task.subtasks.length} subtasks${testsFailing ? " (stopped: tests failing)" : ""}`);

  const changes = completedSubtasks.join("\n");
  const partial = completedSubtasks.length < task.subtasks.length;
  const partialNote = partial
    ? `\n\n> **Note**: ${completedSubtasks.length}/${task.subtasks.length} subtasks completed${testsFailing ? " (stopped due to test failure)" : ""}`
    : "";

  // Create PR even for partial completion — completed subtasks are still valuable
  const result: AnalysisResult = completedSubtasks.length > 0
    ? {
        has_changes: true,
        summary: changes,
        pr_title: task.title,
        pr_body: `## Janitor Agent - ${task.title}\n\n${task.description}\n\n### Changes\n\n${changes}${partialNote}\n\n---\n*Created by [janitor-agent](https://github.com/msvens/janitor-agent)*`,
      }
    : {
        has_changes: false,
        summary: testsFailing ? "Stopped: tests failing" : "No subtasks completed",
        pr_title: "",
        pr_body: "",
      };

  const costUsd =
    estimateCost("ollama", ollamaUsage) +
    estimateCost("claude", claudeUsage, config.claude.model);
  return { result, costUsd };
}

// Always uses Claude — local models can't reliably fix test failures
export async function fixTestFailures(
  testOutput: string,
  repoPath: string,
  config: Config,
  file?: string,
  change?: string,
): Promise<{ costUsd: number; usage: ChatUsage }> {
  const prompt = FIX_PROMPT
    .replace("{{TEST_OUTPUT}}", testOutput.slice(0, 5000))
    .replace(/\{\{FILE\}\}/g, file ?? "the modified file")
    .replace("{{WHAT}}", change ?? "a maintenance edit");
  const chatFn = getChatFn("claude", config);
  const tools = createTools(repoPath);

  const { usage } = await runAgent({
    chatFn,
    system: prompt,
    prompt: "Fix the test failures described above.",
    tools,
    maxSteps: 10,
    onStepFinish: logStep,
  });

  return { costUsd: estimateCost("claude", usage, config.claude.model), usage };
}
