import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import { CONFIG_PATH } from "./paths";
import type { Config } from "./types";

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

export async function saveConfig(config: Config): Promise<void> {
  const yamlObj = {
    max_cost_per_run: config.max_cost_per_run,
    max_open_prs: config.max_open_prs,
    default_aggressiveness: config.default_aggressiveness,
    claude: {
      model: config.claude.model,
      max_steps: config.claude.max_steps,
    },
    ollama: {
      enabled: config.ollama.enabled,
      host: config.ollama.host,
      model: config.ollama.model,
      num_ctx: config.ollama.num_ctx,
      max_steps: config.ollama.max_steps,
      max_aggressiveness: config.ollama.max_aggressiveness,
    },
    planning: {
      max_steps: config.planning.max_steps,
      workspace_dir: config.planning.workspace_dir.replace(homedir(), "~"),
      backlog_dir: config.planning.backlog_dir.replace(homedir(), "~"),
    },
    repos: config.repos.map((r) => ({
      name: r.name,
      aggressiveness: r.aggressiveness,
      branch: r.branch,
      ...(r.install_command ? { install_command: r.install_command } : {}),
      ...(r.test_command ? { test_command: r.test_command } : {}),
    })),
  };

  const yamlStr = "# Janitor Agent Configuration\n\n" + stringify(yamlObj);
  const tmp = CONFIG_PATH + ".tmp";
  await writeFile(tmp, yamlStr, "utf-8");
  await rename(tmp, CONFIG_PATH);
}
