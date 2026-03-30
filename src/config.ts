import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import type { Config } from "./types.js";

const CONFIG_PATH = resolve(import.meta.dirname, "..", "config.yaml");

export async function loadConfig(): Promise<Config> {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;

  const repos = parsed.repos as Array<Record<string, unknown>> | undefined;
  if (!repos || !Array.isArray(repos) || repos.length === 0) {
    throw new Error("config.yaml must contain at least one repo");
  }

  const defaultAgg = (parsed.default_aggressiveness as number) ?? 2;
  const claudeRaw = parsed.claude as Record<string, unknown> | undefined;
  const ollamaRaw = parsed.ollama as Record<string, unknown> | undefined;
  const planningRaw = parsed.planning as Record<string, unknown> | undefined;

  const config: Config = {
    max_cost_per_run: (parsed.max_cost_per_run as number) ?? 0.5,
    max_open_prs: (parsed.max_open_prs as number) ?? 5,
    default_aggressiveness: defaultAgg,
    claude: {
      model: (claudeRaw?.model as string) ?? "claude-sonnet-4-6",
      max_steps: (claudeRaw?.max_steps as number) ?? 30,
    },
    ollama: {
      enabled: (ollamaRaw?.enabled as boolean) ?? false,
      host: (ollamaRaw?.host as string) ?? "http://localhost:11434",
      model: (ollamaRaw?.model as string) ?? "qwen3-coder",
      num_ctx: (ollamaRaw?.num_ctx as number) ?? 32768,
      max_steps: (ollamaRaw?.max_steps as number) ?? 15,
      max_aggressiveness: (ollamaRaw?.max_aggressiveness as number) ?? 2,
    },
    planning: {
      max_steps: (planningRaw?.max_steps as number) ?? 50,
      workspace_dir: (planningRaw?.workspace_dir as string)?.replace("~", homedir())
        ?? join(homedir(), ".janitor", "workspaces"),
      backlog_dir: (planningRaw?.backlog_dir as string)?.replace("~", homedir())
        ?? join(homedir(), ".janitor", "backlog"),
    },
    repos: repos.map((r) => ({
      name: r.name as string,
      aggressiveness: (r.aggressiveness as number) ?? defaultAgg,
      branch: (r.branch as string) ?? "main",
      install_command: r.install_command as string | undefined,
      test_command: r.test_command as string | undefined,
    })),
  };

  for (const repo of config.repos) {
    if (!repo.name || !repo.name.includes("/")) {
      throw new Error(`Invalid repo name: ${repo.name} (expected owner/repo)`);
    }
    if (repo.aggressiveness < 1 || repo.aggressiveness > 5) {
      throw new Error(`Aggressiveness must be 1-5, got ${repo.aggressiveness} for ${repo.name}`);
    }
  }

  return config;
}
