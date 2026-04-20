# Janitor Agent — Claude Code Instructions

## Project overview

Autonomous code maintenance agent with a Next.js web UI. Scans GitHub repos, identifies maintenance tasks via a planning agent, executes them, and creates PRs. Supports Claude (cloud), Google Gemini (cloud), and Ollama (local) backends, with the backend chosen per agent role (planner, action, fix, review).

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS 4** — web UI on port 3003
- **PostgreSQL** via **Drizzle ORM** — all state (repos, tasks, settings, jobs, PRs)
- **@anthropic-ai/sdk** — Claude API with streaming
- **@google/genai** — Google Gemini API (non-streaming generateContent)
- **ollama** — local LLM client with streaming + undici timeout override
- **zod** + **zod-to-json-schema** — tool parameter validation
- **gh CLI** — GitHub operations (clone, PR creation, status checks)
- **SSE** — real-time job progress streaming to the UI

## Architecture

Web UI at `src/app/`, agent code at `src/agent/`, database at `src/db/`.

### Config split
- **`config.yaml`** — bootstrap only: database_url, port, workspace_dir, ollama.host. Searched at: `JANITOR_CONFIG` env → `~/.janitor/config.yaml` → `/etc/janitor/config.yaml` → `./config.yaml`
- **DB `settings` table** — runtime config, editable from the UI: model names (claude_model, gemini_model, ollama_model), per-role backend selection (planner/action/fix/review), enables, cost/step limits, autopilot.
- **DB `repos` table** — repos to maintain. Managed via UI.
- **Env vars** — `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (get one at https://aistudio.google.com/apikey). Keys never live in config.yaml.
- **One-time migration**: on first `getSettings()` call, any pre-existing `claude.model` / `ollama.model` from config.yaml is copied into the settings table. After that the YAML fields are ignored.

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
- `selectBackend(role, aggressiveness, settings)` where `role = "planner" | "action" | "fix" | "review"`
  - `action`: Ollama for tasks ≤ `ollama_max_aggressiveness` when enabled, else `settings.action_backend`
  - `planner` / `fix` / `review`: return `settings.<role>_backend` directly (typically Claude or Gemini; Ollama allowed but not recommended for planning)
- `getChatFn(backend, config, settings)` — builds ChatFn. Picks model name from `settings.<backend>_model`.
- `modelForBackend(backend, settings)` — returns the current model name for a backend.

### Important patterns
- `runAgent()` loop: call model → parse tool calls → validate with Zod → execute → feed results → repeat
- Claude backend groups consecutive tool results into single `user` message with `tool_result` blocks
- Gemini backend pairs `functionCall` / `functionResponse` by position within a Content (not by ID) — preserve ordering when emitting tool results. `thoughtsTokenCount` from 2.5 models is added to outputTokens so Pro cost doesn't under-report.
- Ollama backend uses custom undici `Agent` with 10-min `headersTimeout` (Node.js default is 300s)
- All agent output streams to UI via `onLog` callback → JobManager EventEmitter → SSE
- Tasks have `changes[]` (planner's findings) — guidance for the action agent, not separate execution units
- Cost tracked per model tier. Current MODEL_PRICING (prefix-matched, longest first, $ per 1M in/out): gemini-2.5-flash-lite $0.10/$0.40, gemini-2.5-flash $0.30/$2.50, gemini-2.5-pro $1.25/$10, claude-haiku $0.80/$4, claude-sonnet $3/$15, claude-opus $15/$75.

## Commands

```bash
pnpm dev              # Start web UI (port 3003)
pnpm build            # Production build
pnpm start            # Production server
pnpm run db:push      # Push schema changes to PostgreSQL
pnpm run db:seed      # Import legacy JSON backlogs
```

## Status and known limitations

- **Turbopack dev crash (webpack workaround)**: Next.js 16.2.x Turbopack has a Map overflow bug in async hooks tracking ([vercel/next.js#91396](https://github.com/vercel/next.js/issues/91396)). The dev server crashes with `RangeError: Map maximum size exceeded` after minutes of use. Surfaced 2026-04-08 after adding auth middleware + configurable prompts (more modules/async per request hit the threshold). Fix: dev script uses `--webpack` flag. Production is unaffected. Watch [PR #91704](https://github.com/vercel/next.js/pull/91704) for the upstream fix — once merged, we can switch back to Turbopack.
- **Transient error handling**: API overloaded (529) marks tasks as `failed`. Should retry.
- `handleReviewComments` doesn't distinguish between already-addressed and new comments
- Local LLM tool calling reliability varies by model — qwen3-coder is the most reliable
- Repos with DB-dependent tests need special handling (fresh clones can't run integration tests)
- **Git auth on servers**: Set `GH_TOKEN` env var and `gh config set git_protocol ssh` for server deployments
- **Private repo support**: Untested for server deployments — needs `GH_TOKEN` + SSH key setup
