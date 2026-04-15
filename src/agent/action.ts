import { createTools } from "./tools";
import { selectBackend, getChatFn, maxStepsForBackend, estimateCost, TOOL_USAGE_HINT } from "./agent";
import { runAgent, type ChatUsage, type StepInfo } from "./loop";
import { runTests } from "./github";
import { getPromptForRepo } from "../db/index";
import type { AnalysisResult, BacklogTask, Config, Settings, RepoConfig, TaskChange } from "./types";

// Fallback prompts (used if DB has no prompts yet)
const FALLBACK_FIX_PROMPT = `You are a code maintenance agent. Your previous edits broke the build/tests.

## Build/test output

{{TEST_OUTPUT}}

## Instructions — you have only 10 steps, be surgical

1. Read the error output above — find the EXACT file and line that failed
2. Read ONLY that file
3. Use editFile to fix the issue (typically: syntax error, missing import, formatting)
4. Do NOT undo your changes — adjust them so the build passes
5. Do NOT create new files
6. Do NOT edit files that were not part of the original task
7. Do NOT run build/test commands yourself — the system will run them after your fix
8. Do NOT explore the repo, run git commands, or read unrelated files
9. If the error is not caused by your changes, output "NOT_MY_FAULT" and stop`;

const FALLBACK_ACTION_PROMPT = `You are a code maintenance agent. Execute the following task.

## Task: {{TASK_TITLE}}

{{TASK_DESCRIPTION}}

## Changes to make

{{CHANGES}}

## Instructions

1. Read each file listed above
2. Make ALL the changes described — they are related and should be done together
3. Handle dependencies between changes (e.g., if you remove an import, also replace its usage)
4. After making changes, use grep to verify you caught ALL instances of the pattern — if the task says "replace X with Y" and you find more instances than listed, fix those too
5. After making all changes, stop — do not explore unrelated files or make unrelated changes`;

function formatChanges(changes: TaskChange[]): string {
  return changes
    .map((c) => `- **${c.file}** (lines ${c.lines}): ${c.what}`)
    .join("\n");
}

async function buildTaskPrompt(task: BacklogTask, isOllama: boolean): Promise<string> {
  const dbPrompt = await getPromptForRepo(task.repo, "action");
  const template = dbPrompt?.content ?? FALLBACK_ACTION_PROMPT;

  let prompt = template
    .replace(/\{\{TASK_TITLE\}\}/g, task.title)
    .replace("{{TASK_DESCRIPTION}}", task.description)
    .replace("{{CHANGES}}", formatChanges(task.changes));

  if (isOllama) {
    prompt += TOOL_USAGE_HINT;
  }

  return prompt;
}

type LogFn = (msg: string) => void;

function makeStepLogger(onLog: LogFn): (step: StepInfo) => void {
  return (step) => {
    for (const tc of step.toolCalls) {
      const args = tc.arguments;
      const summary = args
        ? (args.path ?? args.pattern ?? args.command ?? JSON.stringify(args).slice(0, 80))
        : "[no args]";
      onLog(`Step ${step.stepNumber}: ${tc.name}(${summary})`);
    }
    for (const tr of step.toolResults) {
      if (
        tr.output.length === 0 ||
        tr.output.includes("No matches found") ||
        tr.output.includes("No files found") ||
        tr.output.startsWith("Error")
      ) {
        onLog(`  → ${tr.output.slice(0, 200)}`);
      }
    }
    if (step.toolCalls.length === 0 && step.text) {
      onLog(`Step ${step.stepNumber}: text (${step.text.length} chars)`);
    }
  };
}

export async function executeTask(
  task: BacklogTask,
  repoPath: string,
  config: Config,
  settings: Settings,
  repoConfig: RepoConfig,
  onLog: LogFn = console.log,
): Promise<{ result: AnalysisResult; costUsd: number }> {
  const backend = selectBackend(task.aggressiveness, settings);
  const chatFn = getChatFn(backend, config, settings);
  const maxSteps = maxStepsForBackend(backend, settings);

  onLog(`Task: "${task.title}" — ${task.changes.length} changes (backend=${backend})`);

  const systemPrompt = await buildTaskPrompt(task, backend === "ollama");
  const tools = createTools(repoPath);
  const stepLogger = makeStepLogger(onLog);

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt: "Execute the task according to your instructions. Read the files and make all changes.",
    tools,
    maxSteps,
    onStepFinish: stepLogger,
  });

  onLog(`Agent done: ${steps} steps`);
  if (text) {
    onLog(`Response: ${text.slice(0, 200)}`);
  }

  // Track usage
  const totalUsage: ChatUsage = { ...usage };

  // Test after all changes
  if (repoConfig.test_command) {
    onLog("Running tests...");
    let testResult = await runTests(repoPath, repoConfig.test_command);

    if (!testResult.passed) {
      const maxFixAttempts = 3;
      let fixed = false;

      for (let attempt = 1; attempt <= maxFixAttempts; attempt++) {
        onLog(`Tests failed, asking Claude to fix (attempt ${attempt}/${maxFixAttempts})...`);
        onLog(`Test output: ${testResult.output.slice(0, 1000)}`);

        const fixResult = await fixTestFailures(testResult.output, repoPath, config, settings, onLog);
        totalUsage.inputTokens += fixResult.usage.inputTokens;
        totalUsage.outputTokens += fixResult.usage.outputTokens;

        testResult = await runTests(repoPath, repoConfig.test_command);
        if (testResult.passed) {
          onLog(`Tests pass after fix (attempt ${attempt})`);
          fixed = true;
          break;
        }
      }

      if (!fixed) {
        onLog(`Tests still failing after ${maxFixAttempts} fix attempts`);
        const costUsd = estimateCost("claude", totalUsage, config.claude.model);
        return {
          result: {
            has_changes: false,
            summary: "Tests failing after fix attempts",
            pr_title: "",
            pr_body: "",
          },
          costUsd,
        };
      }
    } else {
      onLog("Tests passed");
    }
  }

  // Build result
  const changes = task.changes.map((c) => `- ${c.file}: ${c.what}`).join("\n");
  const result: AnalysisResult = {
    has_changes: true,
    summary: changes,
    pr_title: task.title,
    pr_body: `## Janitor Agent - ${task.title}\n\n${task.description}\n\n### Changes\n\n${changes}\n\n---\n*Created by [janitor-agent](https://github.com/msvens/janitor-agent)*`,
  };

  const costUsd =
    estimateCost("ollama", { inputTokens: 0, outputTokens: 0 }) +
    estimateCost("claude", totalUsage, config.claude.model);
  return { result, costUsd };
}

export async function fixTestFailures(
  testOutput: string,
  repoPath: string,
  config: Config,
  settings: Settings,
  onLog: LogFn = console.log,
): Promise<{ usage: ChatUsage }> {
  const dbPrompt = await getPromptForRepo("", "fix"); // fix prompt is global, not per-repo
  const template = dbPrompt?.content ?? FALLBACK_FIX_PROMPT;
  const prompt = template.replace("{{TEST_OUTPUT}}", testOutput.slice(0, 5000));
  const chatFn = getChatFn("claude", config, settings);
  const tools = createTools(repoPath);
  const stepLogger = makeStepLogger(onLog);

  const { usage } = await runAgent({
    chatFn,
    system: prompt,
    prompt: "Fix the test failures described above.",
    tools,
    maxSteps: 10,
    onStepFinish: stepLogger,
  });

  return { usage };
}
