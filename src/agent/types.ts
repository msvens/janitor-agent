export type Backend = "claude" | "ollama";

export interface ClaudeConfig {
  model: string;
  max_steps: number;
}

export interface OllamaConfig {
  enabled: boolean;
  host: string;
  model: string;
  num_ctx: number;
  max_steps: number;
  max_aggressiveness: number;
}

export interface RepoConfig {
  name: string;
  aggressiveness: number;
  branch: string;
  install_command?: string;
  test_command?: string;
}

export interface PlanningConfig {
  max_steps: number;
  workspace_dir: string;
  backlog_dir: string;
}

export interface Config {
  max_cost_per_run: number;
  max_open_prs: number;
  default_aggressiveness: number;
  claude: ClaudeConfig;
  ollama: OllamaConfig;
  planning: PlanningConfig;
  repos: RepoConfig[];
}

export interface TrackedPR {
  repo: string;
  pr_number: number;
  branch: string;
  created_at: string;
  last_checked: string;
}

export interface RepoHistory {
  last_analyzed: string;
  last_pr_created?: string;
}

export interface State {
  open_prs: TrackedPR[];
  repo_history: Record<string, RepoHistory>;
  last_run: string;
}

export interface AnalysisResult {
  has_changes: boolean;
  summary: string;
  pr_title: string;
  pr_body: string;
}

// --- Backlog types (Phase 1: Planning Agent) ---

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
  pr_number?: number;
}

export interface RepoBacklog {
  repo: string;
  last_planned: string;
  tasks: BacklogTask[];
}
