import { resolve } from "node:path";

// Project root — works in both CLI (tsx) and Next.js bundled contexts
export const PROJECT_ROOT = resolve(
  import.meta.dirname ?? process.cwd(),
  import.meta.dirname ? "../.." : ".",
);

export const CONFIG_PATH = resolve(PROJECT_ROOT, "config.yaml");
export const PROMPTS_DIR = resolve(PROJECT_ROOT, "prompts");
