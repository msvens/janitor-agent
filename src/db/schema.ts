import { pgTable, text, integer, real, uniqueIndex, index, serial, boolean } from "drizzle-orm/pg-core";

// --- Settings (key-value, runtime config from UI) ---

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// --- Prompts ---

export const prompts = pgTable("prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),  // plan, action, fix, review
  content: text("content").notNull(),
  description: text("description").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// --- Repos ---

export const repos = pgTable("repos", {
  name: text("name").primaryKey(),
  aggressiveness: integer("aggressiveness").notNull().default(2),
  branch: text("branch").notNull().default("main"),
  installCommand: text("install_command"),
  testCommand: text("test_command"),
  lastPlanned: text("last_planned"),
  planPromptId: text("plan_prompt_id").references(() => prompts.id),
  actionPromptId: text("action_prompt_id").references(() => prompts.id),
});

// --- Tasks ---

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull().references(() => repos.name),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  changes: text("changes").notNull().default("[]"),  // JSON-encoded TaskChange[]
  aggressiveness: integer("aggressiveness").notNull().default(2),
  status: text("status").notNull().default("pending"),
  prNumber: integer("pr_number"),
  jobId: text("job_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_tasks_repo_status").on(table.repo, table.status),
  index("idx_tasks_status").on(table.status),
]);

// --- Tracked PRs ---

export const trackedPrs = pgTable("tracked_prs", {
  id: serial("id").primaryKey(),
  repo: text("repo").notNull().references(() => repos.name),
  prNumber: integer("pr_number").notNull(),
  branch: text("branch").notNull(),
  taskId: text("task_id").references(() => tasks.id),
  status: text("status").notNull().default("open"), // open, merged, closed
  createdAt: text("created_at").notNull(),
  lastChecked: text("last_checked").notNull(),
}, (table) => [
  uniqueIndex("idx_prs_repo_number").on(table.repo, table.prNumber),
]);

// --- Jobs ---

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  repo: text("repo"),
  taskId: text("task_id").references(() => tasks.id),
  status: text("status").notNull().default("running"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  costUsd: real("cost_usd").notNull().default(0),
  summary: text("summary"),
  error: text("error"),
}, (table) => [
  index("idx_jobs_status").on(table.status),
]);

// --- Job Steps ---

export const jobSteps = pgTable("job_steps", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  toolCalls: text("tool_calls").notNull().default("[]"),
  toolResults: text("tool_results").notNull().default("[]"),
  text: text("text").notNull().default(""),
  timestamp: text("timestamp").notNull(),
}, (table) => [
  index("idx_steps_job").on(table.jobId),
]);
