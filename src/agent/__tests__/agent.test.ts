import { selectBackend, estimateCost } from "../agent";
import type { Settings } from "../types";

const baseSettings: Settings = {
  max_cost_per_run: 0.5,
  max_open_prs: 5,
  default_aggressiveness: 2,
  claude_model: "claude-sonnet-4-6",
  ollama_model: "qwen3-coder",
  gemini_model: "gemini-2.5-flash",
  ollama_enabled: false,
  ollama_num_ctx: 32768,
  ollama_max_aggressiveness: 2,
  ollama_max_steps: 15,
  claude_max_steps: 15,
  gemini_max_steps: 15,
  planning_max_steps: 25,
  planner_backend: "claude",
  action_backend: "claude",
  fix_backend: "claude",
  review_backend: "claude",
  autopilot_enabled: false,
  autopilot_interval_minutes: 10,
};

describe("selectBackend", () => {
  it("action role uses action_backend when ollama disabled", () => {
    const s = { ...baseSettings, ollama_enabled: false, action_backend: "claude" as const };
    expect(selectBackend("action", 1, s)).toBe("claude");
    expect(selectBackend("action", 5, s)).toBe("claude");
  });

  it("action role falls back to ollama at or below max aggressiveness when enabled", () => {
    const s = { ...baseSettings, ollama_enabled: true, ollama_max_aggressiveness: 2 };
    expect(selectBackend("action", 1, s)).toBe("ollama");
    expect(selectBackend("action", 2, s)).toBe("ollama");
  });

  it("action role uses action_backend above max aggressiveness even when ollama enabled", () => {
    const s = { ...baseSettings, ollama_enabled: true, ollama_max_aggressiveness: 2, action_backend: "gemini" as const };
    expect(selectBackend("action", 3, s)).toBe("gemini");
    expect(selectBackend("action", 5, s)).toBe("gemini");
  });

  it("planner role uses planner_backend regardless of aggressiveness", () => {
    const s = { ...baseSettings, ollama_enabled: true, planner_backend: "gemini" as const };
    expect(selectBackend("planner", 1, s)).toBe("gemini");
    expect(selectBackend("planner", 5, s)).toBe("gemini");
  });

  it("fix role uses fix_backend", () => {
    expect(selectBackend("fix", 0, { ...baseSettings, fix_backend: "gemini" })).toBe("gemini");
  });

  it("review role uses review_backend", () => {
    expect(selectBackend("review", 0, { ...baseSettings, review_backend: "gemini" })).toBe("gemini");
  });
});

describe("estimateCost", () => {
  it("returns 0 for ollama", () => {
    expect(estimateCost("ollama", { inputTokens: 1000, outputTokens: 500 })).toBe(0);
  });

  it("calculates cost for claude sonnet", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-sonnet-4-6");
    expect(cost).toBe(3 + 15);
  });

  it("calculates cost for claude haiku", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-haiku-4-5");
    expect(cost).toBe(0.8 + 4);
  });

  it("calculates cost for claude opus", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-opus-4-6");
    expect(cost).toBe(15 + 75);
  });

  it("defaults to sonnet pricing for unknown models", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-unknown");
    expect(cost).toBe(3 + 15);
  });

  it("calculates cost for gemini 2.5 flash", () => {
    const cost = estimateCost("gemini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "gemini-2.5-flash");
    expect(cost).toBe(0.3 + 2.5);
  });

  it("calculates cost for gemini 2.5 pro", () => {
    const cost = estimateCost("gemini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "gemini-2.5-pro");
    expect(cost).toBe(1.25 + 10);
  });

  it("matches gemini 2.5 flash-lite before flash (longest prefix wins)", () => {
    const cost = estimateCost("gemini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "gemini-2.5-flash-lite");
    expect(cost).toBe(0.1 + 0.4);
  });
});
