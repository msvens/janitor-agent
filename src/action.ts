import { createTools } from "./tools.js";
import { getChatFn, estimateCost, logStep } from "./agent.js";
import { runAgent, type ChatUsage } from "./loop.js";
import { runTests } from "./github.js";
import type { AnalysisResult, BacklogTask, Subtask, Backend, Config, RepoConfig } from "./types.js";

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

const FIX_PROMPT = `Your previous changes broke the tests. Here is the test output:

{{TEST_OUTPUT}}

Fix your changes so the tests pass. Use readFile to check the current state of files, then use editFile to fix the issues. Do not undo your maintenance changes — adjust them so the tests pass.`;

function buildSubtaskPrompt(task: BacklogTask, subtask: Subtask): string {
  return SUBTASK_PROMPT
    .replace("{{TASK_TITLE}}", task.title)
    .replace("{{FILE}}", subtask.file)
    .replace("{{LINE_RANGE}}", `${subtask.line_range[0]}-${subtask.line_range[1]}`)
    .replace("{{WHAT}}", subtask.what)
    .replace("{{WHY}}", subtask.why);
}

export async function executeTask(
  task: BacklogTask,
  repoPath: string,
  config: Config,
  repoConfig: RepoConfig,
): Promise<{ result: AnalysisResult; costUsd: number }> {
  const backend = repoConfig.backend;
  const chatFn = getChatFn(backend, config);
  const maxSteps =
    backend === "ollama" ? config.ollama.max_steps : config.claude.max_steps;

  const totalUsage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
  const completedSubtasks: string[] = [];
  let testsFailing = false;

  console.log(`[action] Task: "${task.title}" — ${task.subtasks.length} subtasks`);

  // Process each subtask with a fresh context
  for (let i = 0; i < task.subtasks.length; i++) {
    const subtask = task.subtasks[i]!;
    const label = `[action] [${i + 1}/${task.subtasks.length}]`;
    console.log(`${label} ${subtask.file} — ${subtask.what.slice(0, 80)}`);

    const tools = createTools(repoPath);
    const systemPrompt = buildSubtaskPrompt(task, subtask);

    try {
      const { usage, steps } = await runAgent({
        chatFn,
        system: systemPrompt,
        prompt: `Make the change to ${subtask.file} as described above.`,
        tools,
        maxSteps,
        onStepFinish: logStep,
      });

      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      console.log(`${label} Done in ${steps} steps`);
    } catch (err) {
      console.error(`${label} Failed: ${(err as Error).message}`);
      continue;
    }

    // Test after each subtask if test command is configured
    if (repoConfig.test_command) {
      console.log(`${label} Running tests...`);
      let testResult = await runTests(repoPath, repoConfig.test_command);

      if (!testResult.passed) {
        console.log(`${label} Tests failed, asking agent to fix...`);
        const fixResult = await fixTestFailures(testResult.output, repoPath, config, backend);
        totalUsage.inputTokens += fixResult.usage.inputTokens;
        totalUsage.outputTokens += fixResult.usage.outputTokens;

        testResult = await runTests(repoPath, repoConfig.test_command);
        if (!testResult.passed) {
          console.error(`${label} Tests still failing after fix attempt — stopping`);
          testsFailing = true;
          break;
        }
        console.log(`${label} Tests pass after fix`);
      } else {
        console.log(`${label} Tests pass`);
      }
    }

    completedSubtasks.push(`- ${subtask.file}: ${subtask.what}`);
  }

  console.log(`[action] Completed ${completedSubtasks.length}/${task.subtasks.length} subtasks${testsFailing ? " (stopped: tests failing)" : ""}`);

  // Build result from completed subtasks
  const changes = completedSubtasks.join("\n");
  const result: AnalysisResult = completedSubtasks.length > 0 && !testsFailing
    ? {
        has_changes: true,
        summary: changes,
        pr_title: task.title,
        pr_body: `## Janitor Agent - ${task.title}\n\n${task.description}\n\n### Changes\n\n${changes}\n\n---\n*Created by [janitor-agent](https://github.com/msvens/janitor-agent)*`,
      }
    : {
        has_changes: false,
        summary: testsFailing ? "Stopped: tests failing" : "No subtasks completed",
        pr_title: "",
        pr_body: "",
      };

  const costUsd = estimateCost(backend, totalUsage, config.claude.model);
  return { result, costUsd };
}

export async function fixTestFailures(
  testOutput: string,
  repoPath: string,
  config: Config,
  backend: Backend,
): Promise<{ costUsd: number; usage: ChatUsage }> {
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

  return { costUsd: estimateCost(backend, usage, config.claude.model), usage };
}
