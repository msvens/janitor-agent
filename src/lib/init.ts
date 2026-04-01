import { loadConfig } from "@/agent/config";
import { initDb, getDb } from "@/db/index";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

async function initialize() {
  const config = await loadConfig();
  initDb(config.database_url);

  // Mark any "running" jobs as failed — if we're starting up, nothing is truly running
  const db = getDb();
  const stale = await db
    .update(schema.jobs)
    .set({ status: "failed", finishedAt: new Date().toISOString(), error: "Server restarted" })
    .where(eq(schema.jobs.status, "running"))
    .returning({ id: schema.jobs.id });

  if (stale.length > 0) {
    console.log(`[init] Marked ${stale.length} stale job(s) as failed: ${stale.map((j) => j.id).join(", ")}`);
  }
}

// Auto-initialize on import (for API routes)
const globalForInit = globalThis as unknown as { janitorInitialized: boolean };
if (!globalForInit.janitorInitialized) {
  globalForInit.janitorInitialized = true;
  initialize().catch(console.error);
}
