# Janitor Agent

An autonomous code maintenance agent that scans GitHub repositories, identifies maintenance tasks, and creates PRs with fixes. Supports both cloud (Anthropic Claude) and local (Ollama) LLM backends.

## How it works

The agent uses a **two-phase architecture**:

**Phase 1 — Planning** (read-only):
- Scans a repo with read-only tools (glob, grep, readFile)
- Produces a structured JSON backlog of up to 5 maintenance tasks
- Each task has file-level subtasks with exact locations and rationale
- Runs with Claude (best results for surveying codebases)

**Phase 2 — Action** (read/write):
- Picks the next pending task from the backlog
- Reads files, makes edits, runs configured tests
- If tests fail, feeds output back to the agent for retry (up to 2 attempts)
- Creates a PR if changes pass tests
- Works with both Claude and Ollama backends

All PRs are labeled `janitor-agent` for easy filtering.

## Backends

| Backend | Provider | Cost | Best for |
|---------|----------|------|----------|
| `claude` | Anthropic API | Pay per token | Complex analysis, planning |
| `ollama` | Local Ollama | Free | Simple tasks, privacy-sensitive repos |

## Aggressiveness levels

Each repo is configured with an aggressiveness level (1-5):

| Level | Name | Scope |
|-------|------|-------|
| 1 | Minimal | Dependency updates only |
| 2 | Conservative | + unused imports, dead code, lint fixes |
| 3 | Moderate | + minor refactors, basic tests |
| 4 | Active | + error handling, modern syntax, integration tests |
| 5 | Aggressive | + type safety, structural suggestions, comprehensive tests |

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated
- For Claude backend: `ANTHROPIC_API_KEY` env var
- For Ollama backend: [Ollama](https://ollama.com/) running locally

## Setup

```bash
pnpm install
cp config.example.yaml config.yaml
# Edit config.yaml with your repos
```

### Ollama setup

If using the Ollama backend:

```bash
brew install ollama
ollama serve                 # start server (leave running)
ollama pull qwen3-coder      # download a model
```

## Usage

### Planning — survey repos and build backlog

```bash
pnpm run plan                              # plan all repos
pnpm run plan -- --repo owner/repo-name    # plan a specific repo
```

### Action — execute tasks from backlog

```bash
pnpm run action                              # execute next task for all repos
pnpm run action -- --repo owner/repo-name    # execute for a specific repo
pnpm run action:dry-run -- --repo owner/repo # dry run (no PR created)
```

### Legacy — single-pass analyze + PR

```bash
pnpm start           # full run
pnpm run dry-run     # analyze without creating PRs
```

### Test backends

```bash
npx tsx src/test-ollama.ts   # test Ollama tool calling
npx tsx src/test-claude.ts   # test Claude API connectivity
```

### Scheduled via launchd (macOS)

```bash
cp com.msvens.janitor-agent.plist ~/Library/LaunchAgents/
# Edit the plist to match your paths
launchctl load ~/Library/LaunchAgents/com.msvens.janitor-agent.plist
```

## Safety controls

- **`max_cost_per_run`** — USD budget limit per run (default $0.50)
- **`max_open_prs`** — stops creating PRs when limit reached
- **Step limits** — configurable max tool calls per agent run
- **Tool sandboxing** — all tools operate in cloned/workspace directories with path traversal protection
- **Test loop** — runs configured test commands after edits; retries on failure before creating PR
- **Dry run mode** — `--dry-run` flag to test without creating PRs

## Architecture

```
src/
  index.ts              Orchestrator — plan/action/legacy modes
  loop.ts               Agent loop + abstraction types (ChatFn, ToolDefinition, runAgent)
  backends/
    claude.ts           Claude SDK integration (streaming)
    ollama.ts           Ollama SDK integration (streaming)
  agent.ts              analyzeRepo, addressComments, getChatFn, cost estimation
  action.ts             Task execution + test failure fixing
  planner.ts            Backlog planning agent
  tools.ts              Tool definitions (readFile, writeFile, editFile, glob, grep, bash)
  backlog.ts            Per-repo backlog persistence + task lifecycle
  github.ts             Git/GitHub operations via gh CLI
  config.ts             Config loading + validation
  state.ts              Runtime state (open PRs, repo history)
  types.ts              Shared TypeScript interfaces
prompts/
  analyze.md            Single-issue analysis prompt
  plan.md               Backlog planning prompt
  action.md             Task execution prompt
config.example.yaml     Example configuration
```

## Tech stack

- **TypeScript** (ESM) with `tsx` for direct execution
- **@anthropic-ai/sdk** — Claude API with streaming
- **ollama** — Ollama client with streaming (prevents timeout issues)
- **zod** + **zod-to-json-schema** — tool parameter validation
- **gh CLI** — all GitHub operations (clone, branch, PR, labels)
- **yaml** — config parsing

## State

Runtime state is stored in `state.json` (gitignored). It tracks:
- Open PRs created by the agent
- Per-repo analysis history
- Last run timestamp

Backlogs are stored in `~/.janitor/backlog/` (configurable). Delete `state.json` to reset runtime state.
