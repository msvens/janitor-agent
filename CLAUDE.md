# Janitor Agent — Claude Code Instructions

## Project overview

Autonomous code maintenance agent with a Next.js web UI. Scans GitHub repos, identifies maintenance tasks via a planning agent, executes them, and creates PRs. Supports Claude (cloud) and Ollama (local) backends, with backend selected by task complexity.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS 4** — web UI on port 3003
- **PostgreSQL** via **Drizzle ORM** — all state (repos, tasks, settings, jobs, PRs)
- **@anthropic-ai/sdk** — Claude API with streaming
- **ollama** — local LLM client with streaming + undici timeout override
- **zod** + **zod-to-json-schema** — tool parameter validation
- **gh CLI** — GitHub operations (clone, PR creation, status checks)
- **SSE** — real-time job progress streaming to the UI

## Architecture

Web UI at `src/app/`, agent code at `src/agent/`, database at `src/db/`.

### Config split
- **`config.yaml`** — bootstrap only: database_url, port, LLM model names/hosts. Searched at: `JANITOR_CONFIG` env → `~/.janitor/config.yaml` → `/etc/janitor/config.yaml` → `./config.yaml`
- **DB `settings` table** — runtime config: cost limits, max steps, aggressiveness, Ollama toggle. Managed via UI.
- **DB `repos` table** — repos to maintain. Managed via UI.

### Key modules
- `src/agent/loop.ts` — Agent loop: `runAgent()` owns tool-calling cycle. Backends implement `ChatFn`
- `src/agent/agent.ts` — `selectBackend()`, `getChatFn()`, `estimateCost()`, `addressComments()`
- `src/agent/action.ts` — `executeTask()` — single agent session per task, all changes at once
- `src/agent/planner.ts` — `planRepo()` — Claude-only, read-only tools, produces task backlog
- `src/agent/tools.ts` — 6 tools: readFile, writeFile, editFile, glob, grep, bash
- `src/agent/jobs/` — `plan-job.ts`, `action-job.ts`, `reconcile-job.ts` — orchestration functions called by JobManager
- `src/lib/job-manager.ts` — Singleton: one job at a time, AbortController, SSE events
- `src/db/schema.ts` — Drizzle schema: repos, tasks, settings, tracked_prs, jobs, job_steps
- `src/db/index.ts` — All database queries

### Backend selection
- `selectBackend(aggressiveness, settings)` — Ollama for tasks ≤ `ollama_max_aggressiveness` when enabled, Claude for everything else
- Planning and test fixing always use Claude
- `getChatFn(backend, config, settings)` — creates chat function from bootstrap config + runtime settings

### Important patterns
- `runAgent()` loop: call model → parse tool calls → validate with Zod → execute → feed results → repeat
- Claude backend groups consecutive tool results into single `user` message with `tool_result` blocks
- Ollama backend uses custom undici `Agent` with 10-min `headersTimeout` (Node.js default is 300s)
- All agent output streams to UI via `onLog` callback → JobManager EventEmitter → SSE
- Tasks have `changes[]` (planner's findings) — guidance for the action agent, not separate execution units
- Cost tracked per model tier (haiku $0.80/$4, sonnet $3/$15, opus $15/$75 per 1M tokens)

## Commands

```bash
pnpm dev              # Start web UI (port 3003)
pnpm build            # Production build
pnpm start            # Production server
pnpm run db:push      # Push schema changes to PostgreSQL
pnpm run db:seed      # Import legacy JSON backlogs
```

## Status and known limitations

- **Transient error handling**: API overloaded (529) marks tasks as `failed`. Should retry.
- `handleReviewComments` doesn't distinguish between already-addressed and new comments
- Local LLM tool calling reliability varies by model — qwen3-coder is the most reliable
- Repos with DB-dependent tests need special handling (fresh clones can't run integration tests)
- **Git auth on servers**: Set `GH_TOKEN` env var and `gh config set git_protocol ssh` for server deployments
- **Private repo support**: Untested for server deployments — needs `GH_TOKEN` + SSH key setup
