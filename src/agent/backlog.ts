import * as db from "../db/index";
import type { BacklogTask, RepoBacklog, TaskStatus } from "./types";

export async function loadBacklog(repo: string): Promise<RepoBacklog> {
  return db.loadBacklog(repo);
}

export function generateTaskId(repo: string, seq: number): string {
  const short = repo.split("/")[1] ?? repo;
  return `${short}-${Date.now()}-${seq}`;
}

export async function addTasks(repo: string, tasks: BacklogTask[]): Promise<void> {
  await db.addTasks(repo, tasks);
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
  _repo: string,
  taskId: string,
  status: TaskStatus,
  prNumber?: number,
  jobId?: string,
  skipReason?: string,
): Promise<void> {
  await db.updateTaskStatus(taskId, status, prNumber, jobId, skipReason);
}

export function getNextTask(backlog: RepoBacklog): BacklogTask | undefined {
  return pendingTasks(backlog)[0];
}

export async function findTaskByPR(
  repo: string,
  prNumber: number,
): Promise<BacklogTask | undefined> {
  return (await db.findTaskByPR(repo, prNumber)) ?? undefined;
}
