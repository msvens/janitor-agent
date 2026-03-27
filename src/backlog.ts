import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BacklogTask, RepoBacklog, TaskStatus } from "./types.js";

let backlogDir = "";

export function initBacklog(dir: string): void {
  backlogDir = dir;
}

function backlogPath(repo: string): string {
  return join(backlogDir, `${repo.replace("/", "-")}.json`);
}

function defaultBacklog(repo: string): RepoBacklog {
  return {
    repo,
    last_planned: "",
    tasks: [],
  };
}

export async function loadBacklog(repo: string): Promise<RepoBacklog> {
  try {
    const raw = await readFile(backlogPath(repo), "utf-8");
    return JSON.parse(raw) as RepoBacklog;
  } catch {
    return defaultBacklog(repo);
  }
}

export async function saveBacklog(backlog: RepoBacklog): Promise<void> {
  await mkdir(backlogDir, { recursive: true });
  const path = backlogPath(backlog.repo);
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(backlog, null, 2) + "\n", "utf-8");
  await rename(tmp, path);
}

export function generateTaskId(repo: string, seq: number): string {
  const short = repo.split("/")[1] ?? repo;
  return `${short}-${Date.now()}-${seq}`;
}

export async function addTasks(repo: string, tasks: BacklogTask[]): Promise<void> {
  const backlog = await loadBacklog(repo);
  const existingTitles = new Set(
    backlog.tasks.filter((t) => t.status === "pending").map((t) => t.title),
  );
  const newTasks = tasks.filter((t) => !existingTitles.has(t.title));
  backlog.tasks.push(...newTasks);
  backlog.last_planned = new Date().toISOString();
  await saveBacklog(backlog);
}

export function pendingTasks(backlog: RepoBacklog): BacklogTask[] {
  return backlog.tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => a.aggressiveness - b.aggressiveness);
}

export function needsPlanning(backlog: RepoBacklog): boolean {
  return backlog.tasks.length === 0 || pendingTasks(backlog).length === 0;
}

export async function updateTaskStatus(
  repo: string,
  taskId: string,
  status: TaskStatus,
  prNumber?: number,
): Promise<void> {
  const backlog = await loadBacklog(repo);
  const task = backlog.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = status;
  if (prNumber !== undefined) task.pr_number = prNumber;
  await saveBacklog(backlog);
}

export function getNextTask(backlog: RepoBacklog): BacklogTask | undefined {
  return pendingTasks(backlog)[0];
}

export async function findTaskByPR(
  repo: string,
  prNumber: number,
): Promise<BacklogTask | undefined> {
  const backlog = await loadBacklog(repo);
  return backlog.tasks.find((t) => t.pr_number === prNumber);
}
