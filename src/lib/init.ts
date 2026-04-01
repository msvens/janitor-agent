import { loadConfig } from "@/agent/config";
import { initDb } from "@/db/index";

let _initialized = false;

export async function ensureInitialized() {
  if (_initialized) return;
  const config = await loadConfig();
  initDb(config.database_url);
  _initialized = true;
}

// Auto-initialize on import (for API routes)
const globalForInit = globalThis as unknown as { janitorInitialized: boolean };
if (!globalForInit.janitorInitialized) {
  globalForInit.janitorInitialized = true;
  loadConfig().then((config) => initDb(config.database_url)).catch(console.error);
}
