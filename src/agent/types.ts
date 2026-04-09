export type Backend = "claude" | "ollama";

// Bootstrap config (from config.yaml — connection info only)
export interface Config {
  database_url: string;
  port: number;
  claude: { model: string };
  ollama: { host: string; model: string };
}

// Runtime settings (from DB — tunable via UI)
export interface Settings {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  ollama_enabled: boolean;
  ollama_num_ctx: number;
  ollama_max_aggressiveness: number;
  ollama_max_steps: number;
  claude_max_steps: number;
  planning_max_steps: number;
  workspace_dir: string;
  autopilot_enabled: boolean;
  autopilot_interval_minutes: number;
}

// Repo config (from DB — managed via UI)
export interface RepoConfig {
  name: string;
  aggressiveness: number;
  branch: string;
  install_command?: string;
  test_command?: string;
  plan_prompt_id?: string;
  action_prompt_id?: string;
}

export interface TrackedPR {
  repo: string;
  pr_number: number;
  branch: string;
  created_at: string;
  last_checked: string;
}

export interface State {
  open_prs: TrackedPR[];
  repo_history: Record<string, string>;
  last_run: string;
}

export interface AnalysisResult {
  has_changes: boolean;
  summary: string;
  pr_title: string;
  pr_body: string;
}

// --- Backlog types ---

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface TaskChange {
  file: string;
  lines: string;
  what: string;
}

export interface BacklogTask {
  id: string;
  repo: string;
  title: string;
  description: string;
  changes: TaskChange[];
  aggressiveness: number;
  status: TaskStatus;
  created_at: string;
  updated_at?: string;
  pr_number?: number;
  job_id?: string;
}

export interface RepoBacklog {
  repo: string;
  last_planned: string;
  tasks: BacklogTask[];
}
