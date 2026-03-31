import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadOnlyTools, type StepTracker } from "./tools";
import { LEVEL_DESCRIPTIONS, estimateCost, logStep, getChatFn } from "./agent";
import { runAgent, type StepInfo } from "./loop";
import { PROMPTS_DIR } from "./paths";
import type { BacklogTask, Config, RepoBacklog, RepoConfig } from "./types";

const PLAN_PROMPT_PATH = resolve(PROMPTS_DIR, "plan.md");

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
  };
}

function buildExistingTasksSection(backlog: RepoBacklog): string {
  const existing = backlog.tasks.filter(
    (t) => t.status !== "failed" && t.status !== "skipped",
  );
  if (existing.length === 0) return "";

  const taskList = existing
    .map((t) => `- "${t.title}" (${t.status})`)
    .join("\n");

  return `## Already Known Tasks

The following tasks have already been identified for this repo. Do NOT suggest these again — find NEW issues only.

${taskList}`;
}

function buildPlanPrompt(
  aggressiveness: number,
  template: string,
  backlog: RepoBacklog,
): string {
  const levelDesc =
    LEVEL_DESCRIPTIONS[aggressiveness] ?? LEVEL_DESCRIPTIONS[2]!;
  return template
    .replace("{{LEVEL}}", String(aggressiveness))
    .replace("{{LEVEL_DESCRIPTION}}", levelDesc)
    .replace("{{EXISTING_TASKS}}", buildExistingTasksSection(backlog));
}

function parsePlanResult(text: string): Omit<BacklogTask, "id" | "repo" | "status" | "created_at">[] {
  if (text.includes("JANITOR_BACKLOG_EMPTY")) {
    return [];
  }

  const match = text.match(
    /JANITOR_BACKLOG_START\s*\n?([\s\S]*?)JANITOR_BACKLOG_END/,
  );

  let jsonStr = match?.[1]?.trim();
  if (!jsonStr) {
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    jsonStr = arrayMatch?.[0];
  }

  if (!jsonStr) {
    console.warn("[planner] Could not find task JSON in output");
    return [];
  }

  try {
    const tasks = JSON.parse(jsonStr);
    if (!Array.isArray(tasks)) {
      console.warn("[planner] Parsed JSON is not an array");
      return [];
    }
    return tasks.filter((t) => {
      if (!t.title || !t.changes || !Array.isArray(t.changes)) {
        console.warn(`[planner] Skipping invalid task: ${JSON.stringify(t).slice(0, 100)}`);
        return false;
      }
      return true;
    });
  } catch (err) {
    console.warn(`[planner] JSON parse failed: ${(err as Error).message}`);
    console.warn(`[planner] Raw text (first 500 chars): ${jsonStr.slice(0, 500)}`);
    return [];
  }
}

export async function planRepo(
  repoPath: string,
  repoConfig: RepoConfig,
  config: Config,
  existingBacklog: RepoBacklog,
  onLog: LogFn = console.log,
): Promise<{ tasks: BacklogTask[]; costUsd: number }> {
  const template = await readFile(PLAN_PROMPT_PATH, "utf-8");
  const systemPrompt = buildPlanPrompt(repoConfig.aggressiveness, template, existingBacklog);
  const chatFn = getChatFn("claude", config);
  const maxSteps = config.planning.max_steps;
  const stepTracker: StepTracker = { current: 0, max: maxSteps };
  const tools = createReadOnlyTools(repoPath, stepTracker);
  const stepLogger = makeStepLogger(onLog);

  onLog(`Planning ${repoConfig.name} (aggressiveness=${repoConfig.aggressiveness})`);

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt:
      "Survey this repository and produce a backlog of maintenance tasks according to your instructions.",
    tools,
    maxSteps,
    onStepFinish: stepLogger,
  });

  onLog(`Planner done: ${steps} steps`);
  if (text) {
    onLog(`Result: ${text.slice(0, 300)}`);
  }

  const rawTasks = parsePlanResult(text);
  const now = Date.now();
  const tasks: BacklogTask[] = rawTasks.map((t, i) => ({
    ...t,
    id: `${repoConfig.name.split("/")[1]}-${now}-${i + 1}`,
    repo: repoConfig.name,
    status: "pending" as const,
    created_at: new Date(now).toISOString(),
    aggressiveness: t.aggressiveness ?? repoConfig.aggressiveness,
    changes: t.changes ?? [],
  }));

  onLog(`Found ${tasks.length} tasks`);
  const costUsd = estimateCost("claude", usage, config.claude.model);
  return { tasks, costUsd };
}
