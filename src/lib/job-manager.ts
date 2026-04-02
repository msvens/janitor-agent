import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import "@/lib/init";
import { createJob, updateJob, getSettings, updateSettings, addJobStep } from "@/db/index";
import { runPlanJob } from "@/agent/jobs/plan-job";
import { runActionJob } from "@/agent/jobs/action-job";
import { runReconcileJob } from "@/agent/jobs/reconcile-job";

export type JobType = "plan" | "action" | "reconcile";
export type JobStatus = "running" | "completed" | "failed" | "aborted";

export interface JobLogEvent {
  jobId: string;
  message: string;
  timestamp: string;
}

class JobManager extends EventEmitter {
  private currentJob: { id: string; controller: AbortController } | null = null;
  private jobLogs = new Map<string, string[]>();
  private autopilotTimer: ReturnType<typeof setTimeout> | null = null;
  private _autopilotRunning = false;

  // --- Job state ---

  isRunning(): boolean {
    return this.currentJob !== null;
  }

  getRunningJobId(): string | null {
    return this.currentJob?.id ?? null;
  }

  getLogs(jobId: string): string[] {
    return this.jobLogs.get(jobId) ?? [];
  }

  // --- Auto-pilot ---

  get autopilotActive(): boolean {
    return this._autopilotRunning;
  }

  async startAutopilot(): Promise<void> {
    if (this._autopilotRunning) return;
    this._autopilotRunning = true;
    await updateSettings({ autopilot_enabled: true });
    this.emit("autopilot:change", true);
    console.log("[autopilot] Started");
    this.runAutopilotCycle();
  }

  async stopAutopilot(): Promise<void> {
    this._autopilotRunning = false;
    if (this.autopilotTimer) {
      clearTimeout(this.autopilotTimer);
      this.autopilotTimer = null;
    }
    await updateSettings({ autopilot_enabled: false });
    this.emit("autopilot:change", false);
    console.log("[autopilot] Stopped");
  }

  private async runAutopilotCycle(): Promise<void> {
    if (!this._autopilotRunning) return;

    try {
      // 1. Reconcile
      if (!this.isRunning()) {
        console.log("[autopilot] Running reconcile...");
        await this.startJob("reconcile");
        // Wait for it to finish
        await this.waitForCurrentJob();
      }

      // 2. Run action (picks next pending task respecting limits)
      if (!this.isRunning() && this._autopilotRunning) {
        console.log("[autopilot] Running action...");
        await this.startJob("action");
        await this.waitForCurrentJob();
      }
    } catch (err) {
      console.error("[autopilot] Cycle error:", (err as Error).message);
    }

    // Schedule next cycle
    if (this._autopilotRunning) {
      const settings = await getSettings();
      const intervalMs = settings.autopilot_interval_minutes * 60 * 1000;
      console.log(`[autopilot] Next cycle in ${settings.autopilot_interval_minutes} min`);
      this.autopilotTimer = setTimeout(() => this.runAutopilotCycle(), intervalMs);
    }
  }

  private waitForCurrentJob(): Promise<void> {
    if (!this.currentJob) return Promise.resolve();
    const jobId = this.currentJob.id;
    return new Promise((resolve) => {
      this.once(`job:${jobId}:done`, () => resolve());
    });
  }

  // --- Manual job control ---

  async startJob(type: JobType, repo?: string, taskId?: string): Promise<string> {
    if (this.currentJob) {
      throw new Error("A job is already running");
    }

    const jobId = randomUUID();
    const controller = new AbortController();
    this.currentJob = { id: jobId, controller };
    this.jobLogs.set(jobId, []);

    await createJob({ id: jobId, type, repo, taskId });

    let stepCounter = 0;
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

      // Persist to DB for replay after server restart
      stepCounter++;
      addJobStep({
        jobId,
        stepNumber: stepCounter,
        toolCalls: "[]",
        toolResults: "[]",
        text: msg,
      }).catch(() => {}); // don't fail the job if DB write fails
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
      const options = { repo, taskId, jobId, onLog, signal: controller.signal };
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
