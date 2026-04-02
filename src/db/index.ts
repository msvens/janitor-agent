import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, asc, desc } from "drizzle-orm";
import * as schema from "./schema";
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
  ollama_enabled: false,
  ollama_num_ctx: 32768,
  ollama_max_aggressiveness: 2,
  ollama_max_steps: 15,
  claude_max_steps: 15,
  planning_max_steps: 25,
  workspace_dir: "~/.janitor/workspaces",
  autopilot_enabled: false,
  autopilot_interval_minutes: 10,
};

export async function getSettings(): Promise<Settings> {
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

// --- Repos ---

export async function upsertRepo(repo: {
  name: string;
  aggressiveness: number;
  branch: string;
  installCommand?: string;
  testCommand?: string;
}) {
  const db = getDb();
  await db.insert(schema.repos)
    .values({
      name: repo.name,
      aggressiveness: repo.aggressiveness,
      branch: repo.branch,
      installCommand: repo.installCommand ?? null,
      testCommand: repo.testCommand ?? null,
    })
    .onConflictDoUpdate({
      target: schema.repos.name,
      set: {
        aggressiveness: repo.aggressiveness,
        branch: repo.branch,
        installCommand: repo.installCommand ?? null,
        testCommand: repo.testCommand ?? null,
      },
    });
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
    .orderBy(asc(schema.tasks.aggressiveness));

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
) {
  const db = getDb();
  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (prNumber !== undefined) updates.prNumber = prNumber;

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
    created_at: row.createdAt,
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
  const existing = new Set(
    (await getTasksForRepo(repo, "pending")).map((t) => t.title),
  );
  for (const task of newTasks) {
    if (!existing.has(task.title)) {
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

export async function updatePRStatus(repo: string, prNumber: number, status: string) {
  const db = getDb();
  await db.update(schema.trackedPrs)
    .set({ status, lastChecked: new Date().toISOString() })
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
  // Update open PRs — mark missing ones as closed, add new ones
  const db = getDb();
  const currentOpen = await getOpenPRs();
  const newPrKeys = new Set(state.open_prs.map((p) => `${p.repo}:${p.pr_number}`));

  // Close PRs no longer in the open list
  for (const pr of currentOpen) {
    if (!newPrKeys.has(`${pr.repo}:${pr.pr_number}`)) {
      await updatePRStatus(pr.repo, pr.pr_number, "closed");
    }
  }

  // Add new PRs
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
  updates: { status?: string; finishedAt?: string; costUsd?: number; error?: string },
) {
  const db = getDb();
  await db.update(schema.jobs).set(updates).where(eq(schema.jobs.id, jobId));
}

export async function getJob(jobId: string) {
  const db = getDb();
  const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  return rows[0] ?? null;
}

export async function listJobs(limit = 20) {
  const db = getDb();
  return db.select().from(schema.jobs).orderBy(desc(schema.jobs.startedAt)).limit(limit);
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

