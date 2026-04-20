import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getAllPrompts, upsertPrompt, type PromptType } from "./index";

// Inline prompts extracted from source code
const ACTION_PROMPT = `You are a code maintenance agent. Execute the following task.

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

const FIX_PROMPT = `You are a code maintenance agent. Your previous edits broke the build/tests.

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

const REVIEW_PROMPT = `You are a code maintenance agent. A reviewer left comments on your PR. Address them by making the requested changes. If a comment is not actionable (e.g., "looks good"), skip it.`;

const DEFAULT_PROMPTS: Array<{
  name: string;
  type: PromptType;
  content: string;
  description: string;
}> = [
  {
    name: "Default Plan",
    type: "plan",
    content: "", // Will be loaded from plan.md
    description: "Survey a repo and produce a backlog of maintenance tasks. Placeholders: {{LEVEL}}, {{LEVEL_DESCRIPTION}}, {{EXISTING_TASKS}}",
  },
  {
    name: "Default Action",
    type: "action",
    content: ACTION_PROMPT,
    description: "Execute a specific maintenance task. Placeholders: {{TASK_TITLE}}, {{TASK_DESCRIPTION}}, {{CHANGES}}",
  },
  {
    name: "Default Fix",
    type: "fix",
    content: FIX_PROMPT,
    description: "Fix test failures caused by agent edits. Placeholder: {{TEST_OUTPUT}}",
  },
  {
    name: "Default Address Comments",
    type: "address",
    content: REVIEW_PROMPT,
    description: "Address PR review comments. Comments are passed as user prompt.",
  },
];

export async function seedDefaultPrompts() {
  const existing = await getAllPrompts();
  if (existing.length > 0) return; // Already seeded

  console.log("[seed] Seeding default prompts...");

  // Load plan.md for the plan prompt
  try {
    const planMdPath = resolve(
      import.meta.dirname ?? process.cwd(),
      import.meta.dirname ? "../.." : ".",
      "prompts",
      "plan.md",
    );
    const planContent = await readFile(planMdPath, "utf-8");
    DEFAULT_PROMPTS[0]!.content = planContent;
  } catch {
    console.warn("[seed] Could not load prompts/plan.md, using empty plan prompt");
  }

  for (const prompt of DEFAULT_PROMPTS) {
    await upsertPrompt({
      id: randomUUID(),
      name: prompt.name,
      type: prompt.type,
      content: prompt.content,
      description: prompt.description,
      is_default: true,
    });
    console.log(`[seed] Created default prompt: ${prompt.name}`);
  }
}
