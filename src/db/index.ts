import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, asc } from "drizzle-orm";
import * as schema from "./schema";
import type {
  BacklogTask,
  RepoBacklog,
  State,
  TrackedPR,
  TaskStatus,
  Subtask,
} from "../agent/types";

// --- Connection ---

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/janitor";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  _db = drizzle(pool, { schema });
  return _db;
}

export function closeDb() {
  _db = null;
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

  // Check if task already exists (dedup)
  const existing = await db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id));
  if (existing.length > 0) return;

  await db.insert(schema.tasks)
    .values({
      id: task.id,
      repo: task.repo,
      title: task.title,
      description: task.description,
      aggressiveness: task.aggressiveness,
      status: task.status,
      prNumber: task.pr_number ?? null,
      createdAt: task.created_at,
      updatedAt: now,
    });

  for (let i = 0; i < task.subtasks.length; i++) {
    const st = task.subtasks[i]!;
    await db.insert(schema.subtasks)
      .values({
        taskId: task.id,
        file: st.file,
        lineStart: st.line_range[0],
        lineEnd: st.line_range[1],
        what: st.what,
        why: st.why,
        sortOrder: i,
      });
  }
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

  const tasks: BacklogTask[] = [];
  for (const row of rows) {
    tasks.push(await rowToTask(row));
  }
  return tasks;
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

async function getSubtasksForTask(taskId: string): Promise<Subtask[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.subtasks)
    .where(eq(schema.subtasks.taskId, taskId))
    .orderBy(asc(schema.subtasks.sortOrder));

  return rows.map((row) => ({
    file: row.file,
    line_range: [row.lineStart, row.lineEnd] as [number, number],
    what: row.what,
    why: row.why,
  }));
}

async function rowToTask(row: typeof schema.tasks.$inferSelect): Promise<BacklogTask> {
  return {
    id: row.id,
    repo: row.repo,
    title: row.title,
    description: row.description,
    aggressiveness: row.aggressiveness,
    status: row.status as TaskStatus,
    pr_number: row.prNumber ?? undefined,
    created_at: row.createdAt,
    subtasks: await getSubtasksForTask(row.id),
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
  const db = getDb();
  const conditions = repo ? eq(schema.trackedPrs.repo, repo) : undefined;
  const rows = await db
    .select()
    .from(schema.trackedPrs)
    .where(conditions);

  return rows.map((row) => ({
    repo: row.repo,
    pr_number: row.prNumber,
    branch: row.branch,
    created_at: row.createdAt,
    last_checked: row.lastChecked,
  }));
}

export async function addTrackedPR(pr: TrackedPR) {
  const db = getDb();
  await db.insert(schema.trackedPrs)
    .values({
      repo: pr.repo,
      prNumber: pr.pr_number,
      branch: pr.branch,
      taskId: null,
      createdAt: pr.created_at,
      lastChecked: pr.last_checked,
    })
    .onConflictDoNothing();
}

export async function removeTrackedPR(repo: string, prNumber: number) {
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
  const prs = await getTrackedPRs();
  return {
    open_prs: prs,
    repo_history: {},
    last_run: new Date().toISOString(),
  };
}

export async function saveState(state: State) {
  const db = getDb();
  await db.delete(schema.trackedPrs);
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
  return db.select().from(schema.jobs).orderBy(schema.jobs.startedAt).limit(limit);
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

// --- Init (create tables via drizzle-kit push) ---

export async function initDb() {
  // Tables are created via drizzle-kit push (see package.json db:push script)
  // This just ensures the connection works
  getDb();
}
