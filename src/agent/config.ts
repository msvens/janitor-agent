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
      ollama: { host: "http://localhost:11434" },
    };
  }

  const parsed = parse(raw) as Record<string, unknown>;
  const ollamaRaw = parsed.ollama as Record<string, unknown> | undefined;
  const planningRaw = parsed.planning as Record<string, unknown> | undefined;

  return {
    database_url: process.env.DATABASE_URL ?? (parsed.database_url as string) ?? "postgresql://localhost:5432/janitor",
    port: (parsed.port as number) ?? 3003,
    workspace_dir: (planningRaw?.workspace_dir as string) ?? (parsed.workspace_dir as string) ?? "~/.janitor/workspaces",
    ollama: {
      host: (ollamaRaw?.host as string) ?? "http://localhost:11434",
    },
  };
}

// One-shot migration: copy pre-existing claude.model / ollama.model from YAML into
// the DB settings table on first boot, so users who customized those values keep them.
// After the migration they live in settings only; YAML fields are ignored forever after.
export async function migrateConfigToSettings(): Promise<void> {
  const { hasSettingKey, updateSettings } = await import("../db/index");

  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf-8");
  } catch {
    return;
  }

  const parsed = parse(raw) as Record<string, unknown>;
  const claudeRaw = parsed.claude as Record<string, unknown> | undefined;
  const ollamaRaw = parsed.ollama as Record<string, unknown> | undefined;

  const updates: Record<string, string> = {};
  if (typeof claudeRaw?.model === "string" && !(await hasSettingKey("claude_model"))) {
    updates.claude_model = claudeRaw.model;
  }
  if (typeof ollamaRaw?.model === "string" && !(await hasSettingKey("ollama_model"))) {
    updates.ollama_model = ollamaRaw.model;
  }

  if (Object.keys(updates).length > 0) {
    await updateSettings(updates as Partial<import("./types").Settings>);
  }
}
