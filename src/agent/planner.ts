import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadOnlyTools, type StepTracker } from "./tools";
import { LEVEL_DESCRIPTIONS, estimateCost, logStep, getChatFn } from "./agent";
import { runAgent } from "./loop";
import { PROMPTS_DIR } from "./paths";
import type { BacklogTask, Config, RepoBacklog, RepoConfig } from "./types";

const PLAN_PROMPT_PATH = resolve(PROMPTS_DIR, "plan.md");

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
      if (!t.title || !t.subtasks || !Array.isArray(t.subtasks)) {
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
): Promise<{ tasks: BacklogTask[]; costUsd: number }> {
  const template = await readFile(PLAN_PROMPT_PATH, "utf-8");
  const systemPrompt = buildPlanPrompt(repoConfig.aggressiveness, template, existingBacklog);
  const chatFn = getChatFn("claude", config);
  const maxSteps = config.planning.max_steps;
  const stepTracker: StepTracker = { current: 0, max: maxSteps };
  const tools = createReadOnlyTools(repoPath, stepTracker);

  const { text, usage, steps } = await runAgent({
    chatFn,
    system: systemPrompt,
    prompt:
      "Survey this repository and produce a backlog of maintenance tasks according to your instructions.",
    tools,
    maxSteps,
    onStepFinish: logStep,
  });

  console.log(`[planner] Done: ${steps} steps`);
  if (text) {
    console.log(`[planner] Final text (first 500 chars): ${text.slice(0, 500)}`);
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
    subtasks: t.subtasks ?? [],
  }));

  const costUsd = estimateCost("claude", usage, config.claude.model);
  return { tasks, costUsd };
}
