# Janitor Agent — Claude Code Instructions

## Project overview

Autonomous code maintenance agent that scans GitHub repos and opens PRs with fixes. Built with TypeScript, direct Claude and Ollama SDKs, and the `gh` CLI. Supports both cloud (Anthropic Claude) and local (Ollama) LLM backends, configurable per-repo.

## Tech stack

- **TypeScript** with ESM modules (`"type": "module"` in package.json)
- **Runtime**: Node.js with `tsx` for direct .ts execution
- **AI**: Custom agent loop (`src/loop.ts`) with direct SDK integration
  - Cloud: `@anthropic-ai/sdk` for Claude models (streaming via `messages.stream()`)
  - Local: `ollama` JS client with `stream: true` to prevent timeouts
  - Tool schemas: Zod definitions converted to JSON Schema via `zod-to-json-schema`
- **GitHub**: All operations via `gh` CLI subprocess calls (not the GitHub API directly)
- **Config**: YAML (`config.yaml`) parsed with the `yaml` package
- **State**: JSON file (`state.json`, gitignored) with atomic writes

## Architecture

Two-phase design: **Plan** (survey repo, produce backlog) → **Act** (execute one task, create PR).

The orchestrator (`src/index.ts`) supports `--plan` and `--action` modes:
- `--plan`: Run planning agent on a repo to produce a backlog of tasks
- `--action`: Pick next pending task from backlog, execute it, create PR
- Default (no flags): Legacy single-pass analyze flow

Key modules:
- `src/loop.ts` — **Agent loop + abstraction types**. Defines `ChatFn`, `ToolDefinition`, `runAgent()`. The loop: call model → parse tool calls → execute with Zod validation → feed results back → repeat until done or maxSteps
- `src/backends/claude.ts` — `createClaudeChatFn(model)` — translates internal messages to Claude API format, streams via `client.messages.stream()`
- `src/backends/ollama.ts` — `createOllamaChatFn(config)` — translates to Ollama format, always streams (`stream: true`) to prevent timeout issues
- `src/agent.ts` — `analyzeRepo()`, `addressComments()`, `getChatFn()`, `estimateCost()`, `parseResult()`. No backend-specific branching — both backends use `runAgent()`
- `src/action.ts` — `executeTask()` and `fixTestFailures()` for Phase 2 task execution
- `src/planner.ts` — `planRepo()` for Phase 1 backlog generation (Claude only, read-only tools)
- `src/tools.ts` — defines 6 tools (readFile, writeFile, editFile, glob, grep, bash) as `ToolDefinition` objects. Factory functions `createTools(cwd)` and `createReadOnlyTools(cwd)` scope tools to a working directory
- `src/backlog.ts` — per-repo JSON backlog persistence with task lifecycle management
- `src/github.ts` — all git/gh operations. Uses `child_process.execFile` (promisified), never shell strings
- `src/config.ts` — loads `config.yaml`, validates aggressiveness 1-5 and backend values
- `src/state.ts` — reads/writes `state.json` with tmp+rename for atomicity
- `src/types.ts` — shared interfaces including `Config`, `RepoConfig`, `OllamaConfig`, `Backend`
- `prompts/analyze.md` — single-issue analysis prompt with `{{LEVEL}}` placeholders
- `prompts/plan.md` — backlog planning prompt with `{{EXISTING_TASKS}}` dedup
- `prompts/action.md` — task execution prompt with `{{TASK_TITLE}}`, `{{SUBTASKS}}`

## Important patterns

- `runAgent()` in `src/loop.ts` owns the full tool-calling loop. Backends just implement `ChatFn: (messages, tools, signal) => Promise<ChatResponse>`
- Tool definitions use Zod for input validation; `zod-to-json-schema` converts them for the API. Validation errors are sent back to the model as tool results so it can retry
- Claude backend groups consecutive tool result messages into a single `user` message with `tool_result` blocks (Claude API requirement)
- Ollama backend always uses `stream: true` and `think: false` (prevents timeouts and qwen3-coder `</think>` tag corruption)
- If the agent exhausts its step budget with no final text, the loop sends one last "output your summary" message
- Tools operate in cloned/workspace directories — path traversal is blocked by `safePath()` check
- Cost tracking: estimated from token usage for Claude, always $0 for Ollama
- PR output parsing uses `JANITOR_SUMMARY_START`/`JANITOR_SUMMARY_END` markers
- Branch naming: `janitor/maintenance-YYYY-MM-DD`
- Step budget tags (`[Step X/Y]`) are prepended to tool results via `StepTracker` in tools.ts

## Config

Backend is configurable per-repo in `config.yaml`:
- `default_backend`: `"claude"` or `"ollama"` (default: `"claude"`)
- `claude.model`: Anthropic model ID (default: `"claude-sonnet-4-20250514"`)
- `ollama.host`: Ollama server URL (default: `"http://localhost:11434"`)
- `ollama.model`: Ollama model name (default: `"qwen3-coder"`)
- Per-repo `backend` field overrides `default_backend`

## Commands

```bash
pnpm run plan              # Planning agent: survey repos, produce backlogs
pnpm run action            # Action agent: execute next pending task, create PR
pnpm run action:dry-run    # Action agent without creating PR
pnpm start                 # Legacy: full run (reconcile PRs + analyze)
pnpm run dry-run           # Legacy: analyze without creating PRs
npx tsc --noEmit           # Type-check
npx tsx src/test-ollama.ts # Test Ollama tool calling
```

## Status and known limitations

Known areas for improvement:

- **Partial subtask resilience**: If a task has 9 subtasks and the process dies after 8, all work is lost — the task gets marked as skipped/failed. Need per-subtask state tracking so progress is preserved across interruptions.
- **Partial PR creation**: If 7/9 subtasks succeed but 1 fails tests, the whole task is marked as no changes. Should create a PR for the successful subtasks with a note about what was skipped.
- **Transient error handling**: API overloaded (529) or network errors mark tasks as `failed` permanently. Should retry on transient errors instead.
- `handleReviewComments` doesn't distinguish between already-addressed and new comments
- No retry logic for transient GitHub API failures
- Local LLM tool calling reliability varies by model — qwen3-coder is the most reliable
- Repos with DB-dependent tests (like mphotos) need special handling — fresh clones can't run integration tests without the DB
- **Git auth in temp clones**: `gh repo clone` uses HTTPS but the cloned repo may not have the `gh` credential helper configured, causing password prompts on `git push`. Will fail for private repos. Fix: run `git config credential.helper '!gh auth git-credential'` in cloned repos, or clone via SSH instead.
- **Private repo support**: Untested — the HTTPS clone + push flow likely breaks without credential helper setup in the temp clone
