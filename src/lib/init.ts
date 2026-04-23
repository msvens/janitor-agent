import { loadConfig } from "@/agent/config";
import { initDb, getDb } from "@/db/index";
import { seedDefaultPrompts } from "@/db/seed-prompts";
import * as schema from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

// A job is considered alive if its latest step (or startedAt, if no steps yet)
// is within this window. Longer than any LLM turn's typical latency, shorter
// than a sane "oh this was probably orphaned" window.
const ALIVE_WINDOW_MS = 2 * 60 * 1000;

async function initialize(): Promise<void> {
  const config = await loadConfig();
  initDb(config.database_url);

  const db = getDb();
  const staleCutoff = new Date(Date.now() - ALIVE_WINDOW_MS).toISOString();

  // A job is stale iff status='running' AND COALESCE(latest_step_ts, started_at) < cutoff.
  // This is the source of truth — we can't rely on in-process JobManager state because
  // Next.js app-router bundles route handlers and RSC pages into separate module graphs,
  // each with its own JobManager instance. The DB is the only shared view.
  const stale = await db
    .update(schema.jobs)
    .set({ status: "aborted", finishedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.jobs.status, "running"),
        sql`COALESCE(
          (SELECT MAX(${schema.jobSteps.timestamp}) FROM ${schema.jobSteps} WHERE ${schema.jobSteps.jobId} = ${schema.jobs.id}),
          ${schema.jobs.startedAt}
        ) < ${staleCutoff}`,
      ),
    )
    .returning({ id: schema.jobs.id });

  if (stale.length > 0) {
    console.log(
      `[init] Marked ${stale.length} interrupted job(s): ${stale.map((j) => j.id).join(", ")}`,
    );
  }

  await seedDefaultPrompts();
}

// Memoize on globalThis where possible. In dev with multiple module contexts
// this may not actually memoize across contexts, which is fine — the time-based
// "is it alive" check above makes double-inits safe.
const globalForInit = globalThis as unknown as {
  janitorInitPromise?: Promise<void>;
};

export function ensureInitialized(): Promise<void> {
  if (globalForInit.janitorInitPromise) return globalForInit.janitorInitPromise;
  globalForInit.janitorInitPromise = initialize().catch((err) => {
    console.error("[init] Initialization failed:", err);
  });
  return globalForInit.janitorInitPromise;
}

ensureInitialized();
