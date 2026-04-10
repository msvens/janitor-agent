import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import type { Config } from "./types";

// Search order for config file
function findConfigPath(): string {
  if (process.env.JANITOR_CONFIG) return process.env.JANITOR_CONFIG;

  const candidates = [
    join(homedir(), ".janitor", "config.yaml"),
    "/etc/janitor/config.yaml",
    join(process.cwd(), "config.yaml"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  return candidates[0]!;
}

export const CONFIG_PATH = findConfigPath();

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf-8");
  } catch {
    return {
      database_url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/janitor",
      port: 3003,
      workspace_dir: "~/.janitor/workspaces",
      claude: { model: "claude-sonnet-4-6" },
      ollama: { host: "http://localhost:11434", model: "qwen3-coder" },
    };
  }

  const parsed = parse(raw) as Record<string, unknown>;
  const claudeRaw = parsed.claude as Record<string, unknown> | undefined;
  const ollamaRaw = parsed.ollama as Record<string, unknown> | undefined;
  const planningRaw = parsed.planning as Record<string, unknown> | undefined;

  return {
    database_url: process.env.DATABASE_URL ?? (parsed.database_url as string) ?? "postgresql://localhost:5432/janitor",
    port: (parsed.port as number) ?? 3003,
    workspace_dir: (planningRaw?.workspace_dir as string) ?? (parsed.workspace_dir as string) ?? "~/.janitor/workspaces",
    claude: {
      model: (claudeRaw?.model as string) ?? "claude-sonnet-4-6",
    },
    ollama: {
      host: (ollamaRaw?.host as string) ?? "http://localhost:11434",
      model: (ollamaRaw?.model as string) ?? "qwen3-coder",
    },
  };
}
