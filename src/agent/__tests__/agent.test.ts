import { selectBackend, estimateCost } from "../agent";
import type { Settings } from "../types";

const baseSettings: Settings = {
  max_cost_per_run: 0.5,
  max_open_prs: 5,
  default_aggressiveness: 2,
  ollama_enabled: false,
  ollama_num_ctx: 32768,
  ollama_max_aggressiveness: 2,
  ollama_max_steps: 15,
  claude_max_steps: 15,
  planning_max_steps: 25,
  autopilot_enabled: false,
  autopilot_interval_minutes: 10,
};

describe("selectBackend", () => {
  it("returns claude when ollama is disabled", () => {
    expect(selectBackend(1, { ...baseSettings, ollama_enabled: false })).toBe("claude");
    expect(selectBackend(2, { ...baseSettings, ollama_enabled: false })).toBe("claude");
  });

  it("returns ollama for tasks at or below max aggressiveness", () => {
    const settings = { ...baseSettings, ollama_enabled: true, ollama_max_aggressiveness: 2 };
    expect(selectBackend(1, settings)).toBe("ollama");
    expect(selectBackend(2, settings)).toBe("ollama");
  });

  it("returns claude for tasks above max aggressiveness", () => {
    const settings = { ...baseSettings, ollama_enabled: true, ollama_max_aggressiveness: 2 };
    expect(selectBackend(3, settings)).toBe("claude");
    expect(selectBackend(5, settings)).toBe("claude");
  });
});

describe("estimateCost", () => {
  it("returns 0 for ollama", () => {
    expect(estimateCost("ollama", { inputTokens: 1000, outputTokens: 500 })).toBe(0);
  });

  it("calculates cost for claude sonnet", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-sonnet-4-6");
    expect(cost).toBe(3 + 15); // $3/M input + $15/M output
  });

  it("calculates cost for claude haiku", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-haiku-4-5");
    expect(cost).toBe(0.8 + 4); // $0.80/M input + $4/M output
  });

  it("calculates cost for claude opus", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-opus-4-6");
    expect(cost).toBe(15 + 75); // $15/M input + $75/M output
  });

  it("defaults to sonnet pricing for unknown models", () => {
    const cost = estimateCost("claude", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, "claude-unknown");
    expect(cost).toBe(3 + 15);
  });
});
