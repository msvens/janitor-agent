# Janitor Agent

An autonomous code maintenance agent with a web UI. Scans GitHub repositories, identifies maintenance tasks, and creates PRs with fixes. Supports three LLM backends — Anthropic Claude (cloud), Google Gemini (cloud), and Ollama (local) — selectable per agent role.

## How it works

The agent uses a **two-phase architecture**, controlled through a web dashboard:

**Phase 1 — Planning** (read-only):
- The planner scans a repo with read-only tools (glob, grep, readFile)
- Produces a structured backlog of up to 5 maintenance tasks
- Each task includes specific file changes with line numbers and rationale
- Aggressiveness level controls task scope (1 = trivial, 5 = significant)

**Phase 2 — Action** (read/write):
- Picks a task from the backlog (or run a specific task from the UI)
- Reads files, makes all changes in one session, runs tests
- Up to 3 fix attempts if tests fail (uses the configured fix backend)
- Creates a PR if changes pass tests

All PRs are labeled `janitor-agent` for easy filtering.

## Backends

Three backends are available. Each **agent role** — planner, action, fix, review — is assigned a backend independently from the Config UI (all default to Claude):

| Backend | Provider | Cost | Notes |
|---------|----------|------|-------|
| `claude` | Anthropic API | Pay per token | Default for all roles; most reliable for planning and fixes |
| `gemini` | Google Gemini API | Pay per token | Cloud alternative; cheaper flash tiers available |
| `ollama` | Local Ollama | Free | Can serve **action** tasks at or below a configurable max aggressiveness (when enabled) |

The `action` role additionally falls back to Ollama for tasks at or below `ollama_max_aggressiveness` when Ollama is enabled; otherwise it uses the configured action backend.

## Aggressiveness levels

Controls both the type of changes AND the task size:

| Level | Scope | PR size | Examples |
|-------|-------|---------|----------|
| 1 | Single change, 1 file | Trivial | Remove one unused import, fix a typo |
| 2 | Few changes, 1-2 files | Small | Remove dead code block, fix a lint issue |
| 3 | Related changes, 2-5 files | Medium | Replace debug prints with logger |
| 4 | Cross-cutting, many files | Large | Add error handling pattern |
| 5 | Architectural | Significant | Refactor module structure |

Set per repo (default 2) in the Config UI.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- PostgreSQL
- [GitHub CLI](https://cli.github.com/) (`gh`)
- SSH key configured for GitHub
- A **GitHub OAuth App** for sign-in (see [Setup](#setup))

## Environment variables

All environment variables are stored in `.env.local` (gitignored). Copy `.env.example` to `.env.local` and fill it in.

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_SECRET` | Yes | NextAuth session signing secret. Generate: `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | Yes | Encrypts each user's GitHub OAuth token at rest. Must decode to exactly 32 bytes: `openssl rand -base64 32`. Losing it forces all users to re-sign-in. |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `ADMIN_GITHUB_IDS` | Yes | Comma-separated numeric GitHub user IDs allowed to sign in as **admin** (full access). Find yours: `curl -s https://api.github.com/users/<login> \| jq .id` |
| `VIEWER_GITHUB_IDS` | No | Comma-separated GitHub user IDs allowed to sign in as **viewer** (read-only). Empty disables the viewer flow; admins implicitly have viewer access. |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GEMINI_API_KEY` | If using Gemini | Google Gemini API key — get one at https://aistudio.google.com/apikey |
| `AUTH_TRUST_HOST` | Server | Set `true` when running behind a proxy so NextAuth trusts the forwarded host. Safe to leave unset locally. |
| `GH_TOKEN` | Fallback | GitHub token used by `gh`/git only for repos with **no owner** assigned. Once every repo has an owner (whose stored OAuth token is used), this can be left unset. |
| `DATABASE_URL` | Server | PostgreSQL connection string. Overrides `database_url` in config.yaml. Default: `postgresql://localhost:5432/janitor` |
| `JANITOR_CONFIG` | No | Custom config file path |

## Setup

```bash
# 1. Clone and install
pnpm install

# 2. Configure GitHub CLI
gh auth login
gh config set git_protocol ssh

# 3. Create database
createdb janitor

# 4. Create config file (bootstrap settings only)
cp config.example.yaml ~/.janitor/config.yaml
# Edit with your database URL / port / Ollama host if needed

# 5. Create a GitHub OAuth App
#    At https://github.com/settings/developers — one per environment.
#    Authorization callback URL must be the PREFIX (no provider suffix):
#      Dev:  http://localhost:3003/api/auth/callback
#      Prod: https://<your-domain>/api/auth/callback
#    This matches both .../callback/github-admin and .../callback/github-viewer.

# 6. Set up environment variables
cp .env.example .env.local
# Fill in AUTH_SECRET, TOKEN_ENCRYPTION_KEY, GITHUB_CLIENT_ID/SECRET,
# ADMIN_GITHUB_IDS (your numeric GitHub ID), ANTHROPIC_API_KEY,
# and GEMINI_API_KEY if you plan to use Gemini.

# 7. Push database schema
pnpm run db:push

# 8. Start the web UI
pnpm dev
```

Open `http://localhost:3003` and sign in with GitHub.

### Config file

The config file (`config.yaml`) contains bootstrap settings only — connection info that requires a restart to change:

```yaml
database_url: postgresql://localhost:5432/janitor
port: 3003

ollama:
  host: http://localhost:11434
```

Config file search order:
1. `JANITOR_CONFIG` environment variable
2. `~/.janitor/config.yaml`
3. `/etc/janitor/config.yaml`
4. `./config.yaml`

Everything else — model names, per-role backend selection, repos, cost limits, aggressiveness, step limits, Ollama toggle — is a runtime setting stored in PostgreSQL and managed through the web UI.

### Ollama setup (optional)

```bash
brew install ollama
ollama serve
ollama pull qwen3-coder
```

Enable Ollama in the web UI settings page. It will be used for action tasks at or below the configured max aggressiveness level.

## Web UI

The dashboard at `localhost:3003` provides:

- **Login** — GitHub OAuth sign-in; admin (full access) or viewer (read-only) roles
- **Dashboard** — repo cards with task counts, quick action buttons
- **Backlogs** — task list per repo, change status, run specific tasks
- **PRs** — tracked open PRs with GitHub links
- **Jobs** — live SSE streaming of agent progress, abort running jobs
- **Prompts** — view and edit the planning / action prompts
- **Config** — edit settings, manage repos, choose per-role backends, toggle Ollama

## Safety controls

- **Cost budget** — configurable per-run USD limit (default $0.50)
- **PR limit** — max open PRs before stopping (default 5)
- **Step limits** — max tool calls per agent run (planning 25, per-backend action 15)
- **Tool sandboxing** — all tools operate in cloned temp directories with path traversal protection
- **Test loop** — runs configured test commands after edits; up to 3 fix attempts
- **Confirmation dialogs** — all destructive actions require confirmation in the UI
- **Role-based access** — viewers are read-only; all mutations require an admin session

## Architecture

```
src/
  app/                    Next.js App Router (pages + API routes)
    login/                GitHub OAuth sign-in
    prompts/              Prompt management UI
  components/             React components (dashboard, backlogs, jobs, config)
  auth.ts                 NextAuth instance
  auth.config.ts          NextAuth providers (github-admin / github-viewer) + role gating
  lib/
    job-manager.ts        Singleton job orchestrator (SSE, abort support)
    init.ts               DB initialization from config
    authz.ts              Server-side admin gating (requireAdmin)
    use-role.ts           Client-side role hook (useIsAdmin)
    github-oauth.ts       Resolve per-repo owner token for git/gh ops
    token-crypto.ts       Encrypt/decrypt stored OAuth tokens
  agent/
    loop.ts               Agent loop (ChatFn, ToolDefinition, runAgent)
    agent.ts              Backend selection, cost estimation, logging
    action.ts             Task execution (single session per task)
    planner.ts            Backlog planning agent
    tools.ts              Tool definitions (readFile, writeFile, editFile, glob, grep, bash)
    config.ts             Bootstrap config loader (YAML)
    github.ts             Git/GitHub operations via gh CLI
    backlog.ts            Backlog queries (thin DB wrapper)
    state.ts              PR tracking (thin DB wrapper)
    backends/
      claude.ts           @anthropic-ai/sdk with streaming
      gemini.ts           @google/genai (generateContent)
      ollama.ts           Ollama client with streaming + extended timeouts
    jobs/
      plan-job.ts         Planning orchestration
      action-job.ts       Action orchestration
      reconcile-job.ts    PR reconciliation + comment handling
  db/
    schema.ts             Drizzle ORM schema (PostgreSQL)
    index.ts              Database queries
    seed.ts               Import from legacy JSON backlogs
prompts/
  plan.md                 Planning agent prompt
  action.md               Action agent prompt
config.example.yaml       Bootstrap config template
.env.example              Environment variable template
```

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS 4**
- **PostgreSQL** via **Drizzle ORM**
- **NextAuth** — GitHub OAuth (admin / viewer roles)
- **@anthropic-ai/sdk** — Claude API with streaming
- **@google/genai** — Google Gemini API
- **ollama** — local LLM client with streaming
- **zod** + **zod-to-json-schema** — tool parameter validation
- **gh CLI** — GitHub operations (clone, PR, labels, status)
- **SSE** — real-time job progress streaming

> Dev server runs with `next dev --webpack` to avoid a Turbopack crash in Next.js 16.2.x; production is unaffected.
