import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, asc, desc, inArray, or } from "drizzle-orm";
import * as schema from "./schema";
import { decryptToken } from "@/lib/token-crypto";
import type {
  BacklogTask,
  RepoBacklog,
  State,
  TrackedPR,
  TaskStatus,
  TaskChange,
  Settings,
  RepoConfig,
} from "../agent/types";

// --- Connection ---

let _db: ReturnType<typeof drizzle> | null = null;
let _dbUrl: string = process.env.DATABASE_URL ?? "postgresql://localhost:5432/janitor";

export function initDb(databaseUrl?: string) {
  if (databaseUrl) _dbUrl = databaseUrl;
  getDb(); // ensure connection
}

export function getDb() {
  if (_db) return _db;
  const pool = new pg.Pool({ connectionString: _dbUrl });
  _db = drizzle(pool, { schema });
  return _db;
}

export function closeDb() {
  _db = null;
}

// --- Settings ---

const DEFAULT_SETTINGS: Settings = {
  max_cost_per_run: 0.50,
  max_open_prs: 5,
  default_aggressiveness: 2,
  claude_model: "claude-sonnet-4-6",
  ollama_model: "qwen3-coder",
  gemini_model: "gemini-2.5-flash",
  ollama_enabled: false,
  ollama_num_ctx: 32768,
  ollama_max_aggressiveness: 2,
  ollama_max_steps: 15,
  claude_max_steps: 15,
  gemini_max_steps: 15,
  planning_max_steps: 25,
  planner_backend: "claude",
  action_backend: "claude",
  fix_backend: "claude",
  review_backend: "claude",
  autopilot_enabled: false,
  autopilot_interval_minutes: 10,
};

export async function hasSettingKey(key: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return rows.length > 0;
}

let migrationRan = false;
async function ensureMigrated(): Promise<void> {
  if (migrationRan) return;
  migrationRan = true;
  try {
    const { migrateConfigToSettings } = await import("../agent/config");
    await migrateConfigToSettings();
    await migrateReviewPromptType();
  } catch {
    migrationRan = false;
  }
}

async function migrateReviewPromptType(): Promise<void> {
  const db = getDb();
  await db.update(schema.prompts)
    .set({ type: "address" })
    .where(eq(schema.prompts.type, "review"));
}

export async function getSettings(): Promise<Settings> {
  await ensureMigrated();
  const db = getDb();
  const rows = await db.select().from(schema.settings);
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      (settings as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      // skip invalid values
    }
  }
  return settings;
}

export async function updateSettings(updates: Partial<Settings>) {
  const db = getDb();
  for (const [key, value] of Object.entries(updates)) {
    await db.insert(schema.settings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: JSON.stringify(value) },
      });
  }
}

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const db = getDb();
  const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  if (rows.length === 0) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(rows[0]!.value) as Settings[K];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

// --- Prompts ---

export type PromptType = "plan" | "action" | "fix" | "address" | "review";

export interface Prompt {
  id: string;
  name: string;
  type: PromptType;
  content: string;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function getAllPrompts(): Promise<Prompt[]> {
  const db = getDb();
  const rows = await db.select().from(schema.prompts).orderBy(schema.prompts.type, schema.prompts.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as PromptType,
    content: r.content,
    description: r.description,
    is_default: r.isDefault,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  const db = getDb();
  const rows = await db.select().from(schema.prompts).where(eq(schema.prompts.id, id));
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id, name: r.name, type: r.type as PromptType, content: r.content,
    description: r.description, is_default: r.isDefault, created_at: r.createdAt, updated_at: r.updatedAt,
  };
}

export async function getDefaultPrompt(type: PromptType): Promise<Prompt | null> {
  const db = getDb();
  const rows = await db.select().from(schema.prompts)
    .where(and(eq(schema.prompts.type, type), eq(schema.prompts.isDefault, true)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id, name: r.name, type: r.type as PromptType, content: r.content,
    description: r.description, is_default: r.isDefault, created_at: r.createdAt, updated_at: r.updatedAt,
  };
}

export async function getPromptForRepo(repoName: string, type: PromptType): Promise<Prompt | null> {
  const repo = await getRepo(repoName);
  if (repo) {
    const promptId = type === "plan" ? repo.planPromptId : type === "action" ? repo.actionPromptId : null;
    if (promptId) {
      const prompt = await getPrompt(promptId);
      if (prompt) return prompt;
    }
  }
  return getDefaultPrompt(type);
}

export async function upsertPrompt(prompt: {
  id: string;
  name: string;
  type: PromptType;
  content: string;
  description?: string;
  is_default?: boolean;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(schema.prompts)
    .values({
      id: prompt.id,
      name: prompt.name,
      type: prompt.type,
      content: prompt.content,
      description: prompt.description ?? "",
      isDefault: prompt.is_default ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.prompts.id,
      set: {
        name: prompt.name,
        content: prompt.content,
        description: prompt.description ?? "",
        isDefault: prompt.is_default ?? false,
        updatedAt: now,
      },
    });
}

export async function deletePrompt(id: string) {
  const db = getDb();
  await db.delete(schema.prompts).where(eq(schema.prompts.id, id));
}

// --- Repos ---

export async function upsertRepo(repo: {
  name: string;
  aggressiveness: number;
  branch: string;
  installCommand?: string;
  testCommand?: string;
  planPromptId?: string | null;
  actionPromptId?: string | null;
  addedByUserId?: number | null;
}) {
  const db = getDb();
  // Only set addedByUserId on insert, and only on update if explicitly provided.
  // Callers that omit it (e.g. config PUT that doesn't know the current user) leave ownership untouched.
  const updateSet: Record<string, unknown> = {
    aggressiveness: repo.aggressiveness,
    branch: repo.branch,
    installCommand: repo.installCommand ?? null,
    testCommand: repo.testCommand ?? null,
    planPromptId: repo.planPromptId ?? null,
    actionPromptId: repo.actionPromptId ?? null,
  };
  if (repo.addedByUserId !== undefined) {
    updateSet.addedByUserId = repo.addedByUserId;
  }
  await db.insert(schema.repos)
    .values({
      name: repo.name,
      aggressiveness: repo.aggressiveness,
      branch: repo.branch,
      installCommand: repo.installCommand ?? null,
      testCommand: repo.testCommand ?? null,
      planPromptId: repo.planPromptId ?? null,
      actionPromptId: repo.actionPromptId ?? null,
      addedByUserId: repo.addedByUserId ?? null,
    })
    .onConflictDoUpdate({
      target: schema.repos.name,
      set: updateSet,
    });
}

export async function getRepoOwnerToken(repoName: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ encrypted: schema.users.encryptedAccessToken, login: schema.users.githubLogin })
    .from(schema.repos)
    .innerJoin(schema.users, eq(schema.repos.addedByUserId, schema.users.id))
    .where(eq(schema.repos.name, repoName))
    .limit(1);
  if (!rows[0]) return null;
  try {
    return decryptToken(rows[0].encrypted);
  } catch (err) {
    console.error(
      `[db] Failed to decrypt token for ${repoName} (owner @${rows[0].login}): ${(err as Error).message}`,
    );
    return null;
  }
}

export async function getRepo(name: string) {
  const db = getDb();
  const rows = await db.select().from(schema.repos).where(eq(schema.repos.name, name));
  return rows[0] ?? null;
}

export async function getAllRepos() {
  const db = getDb();
  return db.select().from(schema.repos);
}

export async function deleteRepo(name: string) {
  const db = getDb();
  await db.delete(schema.repos).where(eq(schema.repos.name, name));
}

export function repoRowToConfig(row: typeof schema.repos.$inferSelect): RepoConfig {
  return {
    name: row.name,
    aggressiveness: row.aggressiveness,
    branch: row.branch,
    install_command: row.installCommand ?? undefined,
    test_command: row.testCommand ?? undefined,
    plan_prompt_id: row.planPromptId ?? undefined,
    action_prompt_id: row.actionPromptId ?? undefined,
  };
}

export async function getRepoConfig(name: string): Promise<RepoConfig | null> {
  const row = await getRepo(name);
  return row ? repoRowToConfig(row) : null;
}

export async function getAllRepoConfigs(): Promise<RepoConfig[]> {
  const rows = await getAllRepos();
  return rows.map(repoRowToConfig);
}

export async function getAllRepoConfigsWithOwners(): Promise<
  (RepoConfig & { added_by_login: string | null })[]
> {
  const db = getDb();
  const rows = await db
    .select({
      repo: schema.repos,
      login: schema.users.githubLogin,
    })
    .from(schema.repos)
    .leftJoin(schema.users, eq(schema.repos.addedByUserId, schema.users.id));
  return rows.map(({ repo, login }) => ({
    ...repoRowToConfig(repo),
    added_by_login: login ?? null,
  }));
}

export async function updateRepoLastPlanned(name: string) {
  const db = getDb();
  await db.update(schema.repos)
    .set({ lastPlanned: new Date().toISOString() })
    .where(eq(schema.repos.name, name));
}

// --- Tasks ---

export async function addTask(task: BacklogTask) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = await db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id));
  if (existing.length > 0) return;

  await db.insert(schema.tasks)
    .values({
      id: task.id,
      repo: task.repo,
      title: task.title,
      description: task.description,
      changes: JSON.stringify(task.changes),
      aggressiveness: task.aggressiveness,
      status: task.status,
      prNumber: task.pr_number ?? null,
      createdAt: task.created_at,
      updatedAt: now,
    });
}

export async function getTasksForRepo(
  repo: string,
  status?: TaskStatus,
): Promise<BacklogTask[]> {
  const db = getDb();

  const conditions = status
    ? and(eq(schema.tasks.repo, repo), eq(schema.tasks.status, status))
    : eq(schema.tasks.repo, repo);

  const rows = await db
    .select()
    .from(schema.tasks)
    .where(conditions)
    .orderBy(desc(schema.tasks.updatedAt));

  return rows.map(rowToTask);
}

export async function getTask(taskId: string): Promise<BacklogTask | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  if (rows.length === 0) return null;
  return rowToTask(rows[0]!);
}

export async function getNextPendingTask(repo: string): Promise<BacklogTask | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.repo, repo), eq(schema.tasks.status, "pending")))
    .orderBy(asc(schema.tasks.aggressiveness))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToTask(rows[0]!);
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  prNumber?: number,
  jobId?: string,
  skipReason?: string,
) {
  const db = getDb();
  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (prNumber !== undefined) updates.prNumber = prNumber;
  if (jobId !== undefined) updates.jobId = jobId;
  if (status === "skipped" && skipReason !== undefined) updates.skipReason = skipReason;
  if (status !== "skipped") updates.skipReason = null;

  await db.update(schema.tasks)
    .set(updates)
    .where(eq(schema.tasks.id, taskId));
}

export async function findTaskByPR(
  repo: string,
  prNumber: number,
): Promise<BacklogTask | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.repo, repo), eq(schema.tasks.prNumber, prNumber)),
    );
  if (rows.length === 0) return null;
  return rowToTask(rows[0]!);
}

export async function getRecentTasks(limit = 10): Promise<BacklogTask[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        // Only show tasks that have been acted on (not just pending)
        // in_progress = currently being worked on or has open PR
        // completed = PR merged
        // failed/skipped = attempted but didn't work
      ),
    )
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(limit);
  // Filter out pending tasks (they haven't been acted on)
  return rows.filter((r) => r.status !== "pending").map(rowToTask);
}

export async function getTaskStats() {
  const db = getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();

  const allTasks = await db.select().from(schema.tasks);
  const todayTasks = allTasks.filter((t) => t.updatedAt >= todayStr && t.status !== "pending");

  // Get today's cost from jobs
  const allJobs = await db.select().from(schema.jobs);
  const todayJobs = allJobs.filter((j) => j.startedAt >= todayStr && j.type === "action");
  const totalCost = todayJobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);

  return {
    today: {
      completed: todayTasks.filter((t) => t.status === "completed").length,
      in_progress: todayTasks.filter((t) => t.status === "in_progress").length,
      failed: todayTasks.filter((t) => t.status === "failed" || t.status === "skipped").length,
      total: todayTasks.length,
      totalCost,
    },
  };
}

export async function deleteTask(taskId: string) {
  const db = getDb();
  await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
}

function rowToTask(row: typeof schema.tasks.$inferSelect): BacklogTask {
  let changes: TaskChange[] = [];
  try {
    changes = JSON.parse(row.changes) as TaskChange[];
  } catch {
    changes = [];
  }

  return {
    id: row.id,
    repo: row.repo,
    title: row.title,
    description: row.description,
    changes,
    aggressiveness: row.aggressiveness,
    status: row.status as TaskStatus,
    pr_number: row.prNumber ?? undefined,
    job_id: row.jobId ?? undefined,
    skip_reason: row.skipReason ?? undefined,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// --- Backlog (compatibility layer) ---

export async function loadBacklog(repo: string): Promise<RepoBacklog> {
  const repoRow = await getRepo(repo);
  const tasks = await getTasksForRepo(repo);
  return {
    repo,
    last_planned: repoRow?.lastPlanned ?? "",
    tasks,
  };
}

export async function hasPendingTasks(repo: string): Promise<boolean> {
  const task = await getNextPendingTask(repo);
  return !!task;
}

export async function addTasks(repo: string, newTasks: BacklogTask[]) {
  const pendingTitles = new Set(
    (await getTasksForRepo(repo, "pending")).map((t) => t.title),
  );
  const skippedTitles = new Set(
    (await getTasksForRepo(repo, "skipped")).map((t) => t.title),
  );
  for (const task of newTasks) {
    if (!pendingTitles.has(task.title) && !skippedTitles.has(task.title)) {
      await addTask(task);
    }
  }
  await updateRepoLastPlanned(repo);
}

// --- Tracked PRs ---

export async function getTrackedPRs(repo?: string): Promise<TrackedPR[]> {
  return getOpenPRs(repo);
}

export async function getOpenPRs(repo?: string): Promise<TrackedPR[]> {
  const db = getDb();
  const conditions = repo
    ? and(eq(schema.trackedPrs.repo, repo), eq(schema.trackedPrs.status, "open"))
    : eq(schema.trackedPrs.status, "open");
  const rows = await db.select().from(schema.trackedPrs).where(conditions).orderBy(desc(schema.trackedPrs.createdAt));
  return rows.map(prRowToTrackedPR);
}

export async function getAllPRs(repo?: string) {
  const db = getDb();
  const conditions = repo ? eq(schema.trackedPrs.repo, repo) : undefined;
  const rows = await db.select().from(schema.trackedPrs).where(conditions).orderBy(desc(schema.trackedPrs.createdAt));
  return rows.map((row) => ({ ...prRowToTrackedPR(row), status: row.status }));
}

function prRowToTrackedPR(row: typeof schema.trackedPrs.$inferSelect): TrackedPR {
  return {
    repo: row.repo,
    pr_number: row.prNumber,
    branch: row.branch,
    created_at: row.createdAt,
    last_checked: row.lastChecked,
  };
}

export async function addTrackedPR(pr: TrackedPR) {
  const db = getDb();
  await db.insert(schema.trackedPrs)
    .values({
      repo: pr.repo,
      prNumber: pr.pr_number,
      branch: pr.branch,
      taskId: null,
      status: "open",
      createdAt: pr.created_at,
      lastChecked: pr.last_checked,
    })
    .onConflictDoNothing();
}

export async function updatePRStatus(repo: string, prNumber: number, status: string, closeReason?: string) {
  const db = getDb();
  const updates: Record<string, unknown> = { status, lastChecked: new Date().toISOString() };
  if (closeReason !== undefined) updates.closeReason = closeReason;
  await db.update(schema.trackedPrs)
    .set(updates)
    .where(
      and(
        eq(schema.trackedPrs.repo, repo),
        eq(schema.trackedPrs.prNumber, prNumber),
      ),
    );
}

export async function removeTrackedPR(repo: string, prNumber: number) {
  // Keep for backwards compat but prefer updatePRStatus
  const db = getDb();
  await db.delete(schema.trackedPrs)
    .where(
      and(
        eq(schema.trackedPrs.repo, repo),
        eq(schema.trackedPrs.prNumber, prNumber),
      ),
    );
}

export async function updatePRLastChecked(repo: string, prNumber: number) {
  const db = getDb();
  await db.update(schema.trackedPrs)
    .set({ lastChecked: new Date().toISOString() })
    .where(
      and(
        eq(schema.trackedPrs.repo, repo),
        eq(schema.trackedPrs.prNumber, prNumber),
      ),
    );
}

export interface ClosedPR {
  repo: string;
  pr_number: number;
  branch: string;
  close_reason?: string;
}

export async function getClosedPRsForRepo(repo: string): Promise<ClosedPR[]> {
  const db = getDb();
  const rows = await db.select().from(schema.trackedPrs)
    .where(and(eq(schema.trackedPrs.repo, repo), eq(schema.trackedPrs.status, "closed")))
    .orderBy(desc(schema.trackedPrs.createdAt));
  return rows.map((row) => ({
    repo: row.repo,
    pr_number: row.prNumber,
    branch: row.branch,
    close_reason: row.closeReason ?? undefined,
  }));
}

// --- State (compatibility layer) ---

export async function loadState(): Promise<State> {
  const prs = await getOpenPRs();
  return {
    open_prs: prs,
    repo_history: {},
    last_run: new Date().toISOString(),
  };
}

export async function saveState(state: State) {
  // Only add new PRs — don't close PRs based on this snapshot.
  // PR status changes are handled explicitly by reconcile via updatePRStatus().
  for (const pr of state.open_prs) {
    await addTrackedPR(pr);
  }
}

// --- Jobs ---

export async function createJob(job: {
  id: string;
  type: string;
  repo?: string;
  taskId?: string;
}) {
  const db = getDb();
  await db.insert(schema.jobs)
    .values({
      id: job.id,
      type: job.type,
      repo: job.repo ?? null,
      taskId: job.taskId ?? null,
      status: "running",
      startedAt: new Date().toISOString(),
      costUsd: 0,
    });
}

export async function updateJob(
  jobId: string,
  updates: { status?: string; finishedAt?: string; costUsd?: number; summary?: string; error?: string },
) {
  const db = getDb();
  await db.update(schema.jobs).set(updates).where(eq(schema.jobs.id, jobId));
}

export async function getJob(jobId: string) {
  const db = getDb();
  const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  return rows[0] ?? null;
}

export async function listJobs(limit = 20, filter?: "tasks-only" | "all") {
  const db = getDb();
  const conditions = filter === "tasks-only"
    ? and(
        eq(schema.jobs.status, schema.jobs.status), // always true placeholder
      )
    : undefined;

  const allJobs = await db.select().from(schema.jobs).orderBy(desc(schema.jobs.startedAt)).limit(limit * 2);

  const filtered = filter === "tasks-only"
    ? allJobs.filter((j) => j.type === "action" || j.type === "plan")
    : allJobs;

  return filtered.slice(0, limit);
}

export async function getJobStats() {
  const db = getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();

  const allToday = await db
    .select()
    .from(schema.jobs)
    .where(and(
      eq(schema.jobs.type, "action"),
    ));

  const todayJobs = allToday.filter((j) => j.startedAt >= todayStr);
  const completed = todayJobs.filter((j) => j.status === "completed");
  const failed = todayJobs.filter((j) => j.status === "failed");
  const totalCost = todayJobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);

  return {
    today: {
      completed: completed.length,
      failed: failed.length,
      totalJobs: todayJobs.length,
      totalCost,
    },
  };
}

export async function getLatestJobForTask(taskId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.taskId, taskId))
    .orderBy(desc(schema.jobs.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function addJobStep(step: {
  jobId: string;
  stepNumber: number;
  toolCalls: string;
  toolResults: string;
  text: string;
}) {
  const db = getDb();
  await db.insert(schema.jobSteps)
    .values({
      ...step,
      timestamp: new Date().toISOString(),
    });
}

export async function getJobSteps(jobId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.jobSteps)
    .where(eq(schema.jobSteps.jobId, jobId))
    .orderBy(asc(schema.jobSteps.stepNumber));
}

// --- Users ---

export interface UserRow {
  id: number;
  githubId: string;
  githubLogin: string;
  encryptedAccessToken: string;
  tokenUpdatedAt: string;
  createdAt: string;
}

export async function upsertUser(input: {
  githubId: string;
  githubLogin: string;
  encryptedAccessToken: string;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  await db
    .insert(schema.users)
    .values({
      githubId: input.githubId,
      githubLogin: input.githubLogin,
      encryptedAccessToken: input.encryptedAccessToken,
      tokenUpdatedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.githubId,
      set: {
        githubLogin: input.githubLogin,
        encryptedAccessToken: input.encryptedAccessToken,
        tokenUpdatedAt: now,
      },
    });
}

export async function getUserByGithubId(githubId: string): Promise<UserRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.githubId, githubId))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteUserByGithubId(githubId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.users).where(eq(schema.users.githubId, githubId));
}

export interface OwnedSummary {
  repos: number;
  tasks: number;
  jobs: number;
  prs: number;
}

export async function getUserOwnedSummary(githubId: string): Promise<OwnedSummary> {
  const db = getDb();
  const user = await getUserByGithubId(githubId);
  if (!user) return { repos: 0, tasks: 0, jobs: 0, prs: 0 };

  const userRepos = await db
    .select({ name: schema.repos.name })
    .from(schema.repos)
    .where(eq(schema.repos.addedByUserId, user.id));
  const repoNames = userRepos.map((r) => r.name);
  if (repoNames.length === 0) return { repos: 0, tasks: 0, jobs: 0, prs: 0 };

  const [tasks, prs, jobs] = await Promise.all([
    db.select({ id: schema.tasks.id }).from(schema.tasks).where(inArray(schema.tasks.repo, repoNames)),
    db.select({ id: schema.trackedPrs.id }).from(schema.trackedPrs).where(inArray(schema.trackedPrs.repo, repoNames)),
    db.select({ id: schema.jobs.id }).from(schema.jobs).where(inArray(schema.jobs.repo, repoNames)),
  ]);

  return {
    repos: repoNames.length,
    tasks: tasks.length,
    jobs: jobs.length,
    prs: prs.length,
  };
}

export async function deleteUserAndRepos(githubId: string): Promise<{
  userDeleted: boolean;
  reposDeleted: string[];
  tasksDeleted: number;
  jobsDeleted: number;
  prsDeleted: number;
}> {
  const db = getDb();
  const user = await getUserByGithubId(githubId);
  if (!user) {
    return { userDeleted: false, reposDeleted: [], tasksDeleted: 0, jobsDeleted: 0, prsDeleted: 0 };
  }

  const userRepos = await db
    .select({ name: schema.repos.name })
    .from(schema.repos)
    .where(eq(schema.repos.addedByUserId, user.id));
  const repoNames = userRepos.map((r) => r.name);

  let tasksDeleted = 0;
  let jobsDeleted = 0;
  let prsDeleted = 0;

  if (repoNames.length > 0) {
    const userTasks = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(inArray(schema.tasks.repo, repoNames));
    const taskIds = userTasks.map((t) => t.id);

    // Jobs first (they reference tasks and repos). job_steps cascade via FK.
    const jobFilter =
      taskIds.length > 0
        ? or(inArray(schema.jobs.repo, repoNames), inArray(schema.jobs.taskId, taskIds))
        : inArray(schema.jobs.repo, repoNames);
    const deletedJobs = await db
      .delete(schema.jobs)
      .where(jobFilter)
      .returning({ id: schema.jobs.id });
    jobsDeleted = deletedJobs.length;

    // tracked_prs rows — these are janitor's INTERNAL tracking records.
    // We do NOT close or touch the actual PRs on GitHub — the human handles those.
    const deletedPrs = await db
      .delete(schema.trackedPrs)
      .where(inArray(schema.trackedPrs.repo, repoNames))
      .returning({ id: schema.trackedPrs.id });
    prsDeleted = deletedPrs.length;

    const deletedTasks = await db
      .delete(schema.tasks)
      .where(inArray(schema.tasks.repo, repoNames))
      .returning({ id: schema.tasks.id });
    tasksDeleted = deletedTasks.length;

    await db.delete(schema.repos).where(inArray(schema.repos.name, repoNames));
  }

  // User last (repos referenced it via added_by_user_id).
  await db.delete(schema.users).where(eq(schema.users.id, user.id));

  return {
    userDeleted: true,
    reposDeleted: repoNames,
    tasksDeleted,
    jobsDeleted,
    prsDeleted,
  };
}

