import { pgTable, text, integer, real, uniqueIndex, index, serial } from "drizzle-orm/pg-core";

// --- Repos ---

export const repos = pgTable("repos", {
  name: text("name").primaryKey(),
  aggressiveness: integer("aggressiveness").notNull().default(2),
  branch: text("branch").notNull().default("main"),
  installCommand: text("install_command"),
  testCommand: text("test_command"),
  lastPlanned: text("last_planned"),
});

// --- Tasks ---

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull().references(() => repos.name),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  aggressiveness: integer("aggressiveness").notNull().default(2),
  status: text("status").notNull().default("pending"),
  prNumber: integer("pr_number"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_tasks_repo_status").on(table.repo, table.status),
  index("idx_tasks_status").on(table.status),
]);

// --- Subtasks ---

export const subtasks = pgTable("subtasks", {
  id: serial("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  file: text("file").notNull(),
  lineStart: integer("line_start").notNull(),
  lineEnd: integer("line_end").notNull(),
  what: text("what").notNull(),
  why: text("why").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  index("idx_subtasks_task").on(table.taskId),
]);

// --- Tracked PRs ---

export const trackedPrs = pgTable("tracked_prs", {
  id: serial("id").primaryKey(),
  repo: text("repo").notNull().references(() => repos.name),
  prNumber: integer("pr_number").notNull(),
  branch: text("branch").notNull(),
  taskId: text("task_id").references(() => tasks.id),
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
