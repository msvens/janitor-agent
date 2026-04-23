export type Backend = "claude" | "ollama" | "gemini";

export type AgentRole = "planner" | "action" | "fix" | "review";

// Bootstrap config (from config.yaml — connection/deployment info)
export interface Config {
  database_url: string;
  port: number;
  workspace_dir: string;
  ollama: { host: string };
}

// Runtime settings (from DB — tunable via UI)
export interface Settings {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  claude_model: string;
  ollama_model: string;
  gemini_model: string;
  ollama_enabled: boolean;
  ollama_num_ctx: number;
  ollama_max_aggressiveness: number;
  ollama_max_steps: number;
  claude_max_steps: number;
  gemini_max_steps: number;
  planning_max_steps: number;
  planner_backend: Backend;
  action_backend: Backend;
  fix_backend: Backend;
  review_backend: Backend;
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
  added_by_login?: string | null;
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
  skip_reason?: string;
}

export interface RepoBacklog {
  repo: string;
  last_planned: string;
  tasks: BacklogTask[];
}
