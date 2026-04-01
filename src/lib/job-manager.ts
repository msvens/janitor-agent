import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import "@/lib/init";
import { createJob, updateJob } from "@/db/index";
import { runPlanJob } from "@/agent/jobs/plan-job";
import { runActionJob } from "@/agent/jobs/action-job";
import { runReconcileJob } from "@/agent/jobs/reconcile-job";

export type JobType = "plan" | "action" | "reconcile";
export type JobStatus = "running" | "completed" | "failed" | "aborted";

export interface JobInfo {
  id: string;
  type: JobType;
  repo?: string;
  status: JobStatus;
  startedAt: string;
  logs: string[];
}

export interface JobLogEvent {
  jobId: string;
  message: string;
  timestamp: string;
}

class JobManager extends EventEmitter {
  private currentJob: { id: string; controller: AbortController } | null = null;
  private jobLogs = new Map<string, string[]>();

  isRunning(): boolean {
    return this.currentJob !== null;
  }

  getRunningJobId(): string | null {
    return this.currentJob?.id ?? null;
  }

  getLogs(jobId: string): string[] {
    return this.jobLogs.get(jobId) ?? [];
  }

  async startJob(type: JobType, repo?: string, taskId?: string): Promise<string> {
    if (this.currentJob) {
      throw new Error(`Job ${this.currentJob.id} is already running`);
    }

    const jobId = randomUUID();
    const controller = new AbortController();
    this.currentJob = { id: jobId, controller };
    this.jobLogs.set(jobId, []);

    // Record in DB
    await createJob({ id: jobId, type, repo, taskId });

    const onLog = (msg: string) => {
      const logs = this.jobLogs.get(jobId);
      if (logs) logs.push(msg);

      const event: JobLogEvent = {
        jobId,
        message: msg,
        timestamp: new Date().toISOString(),
      };
      this.emit(`job:${jobId}`, event);
      this.emit("job:log", event);
    };

    // Fire-and-forget
    this.executeJob(jobId, type, repo, taskId, controller, onLog).catch(() => {});

    return jobId;
  }

  private async executeJob(
    jobId: string,
    type: JobType,
    repo: string | undefined,
    taskId: string | undefined,
    controller: AbortController,
    onLog: (msg: string) => void,
  ): Promise<void> {
    try {
      const options = { repo, taskId, onLog, signal: controller.signal };
      let costUsd = 0;

      switch (type) {
        case "plan": {
          const result = await runPlanJob(options);
          costUsd = result.costUsd;
          break;
        }
        case "action": {
          const result = await runActionJob(options);
          costUsd = result.costUsd;
          break;
        }
        case "reconcile": {
          const result = await runReconcileJob(options);
          costUsd = result.costUsd;
          break;
        }
      }

      await updateJob(jobId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
        costUsd,
      });

      onLog(`Job completed (cost: $${costUsd.toFixed(4)})`);
      this.emit(`job:${jobId}:done`, { status: "completed" });
    } catch (err) {
      const status = controller.signal.aborted ? "aborted" : "failed";
      const error = (err as Error).message;

      await updateJob(jobId, {
        status,
        finishedAt: new Date().toISOString(),
        error,
      });

      onLog(`Job ${status}: ${error}`);
      this.emit(`job:${jobId}:done`, { status });
    } finally {
      this.currentJob = null;
      // Keep logs for 10 minutes then clean up
      setTimeout(() => this.jobLogs.delete(jobId), 10 * 60 * 1000);
    }
  }

  abortJob(jobId: string): boolean {
    if (this.currentJob?.id === jobId) {
      this.currentJob.controller.abort();
      return true;
    }
    return false;
  }
}

// Singleton that survives Next.js HMR
const globalForJobs = globalThis as unknown as { jobManager: JobManager };
export const jobManager =
  globalForJobs.jobManager ?? (globalForJobs.jobManager = new JobManager());
