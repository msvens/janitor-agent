import { resolve } from "node:path";
import { homedir } from "node:os";

// Default workspace directory for cloning repos
export const DEFAULT_WORKSPACE_DIR = resolve(homedir(), ".janitor", "workspaces");

// Prompts directory — relative to project root
export const PROMPTS_DIR = resolve(
  import.meta.dirname ?? process.cwd(),
  import.meta.dirname ? "../.." : ".",
  "prompts",
);
