import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Config module caches CONFIG_PATH on load, so we need to test
// by setting env BEFORE importing. Use dynamic import + jest.resetModules.

describe("loadConfig", () => {
  const origEnv = process.env.JANITOR_CONFIG;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.JANITOR_CONFIG = origEnv;
    } else {
      delete process.env.JANITOR_CONFIG;
    }
    jest.resetModules();
  });

  it("returns defaults when no config file exists", async () => {
    process.env.JANITOR_CONFIG = "/tmp/nonexistent-janitor-config.yaml";
    const { loadConfig } = await import("../config");

    const config = await loadConfig();
    expect(config.port).toBe(3003);
    expect(config.claude.model).toBe("claude-sonnet-4-6");
    expect(config.ollama.model).toBe("qwen3-coder");
    expect(config.database_url).toContain("postgresql://");
  });

  it("loads config from YAML file", async () => {
    const tmpDir = join("/tmp", `janitor-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, "config.yaml");

    writeFileSync(configPath, `
database_url: postgresql://testhost:5432/testdb
port: 4000
claude:
  model: claude-opus-4-6
ollama:
  host: http://myhost:11434
  model: deepseek-coder
`);

    process.env.JANITOR_CONFIG = configPath;
    const { loadConfig } = await import("../config");

    try {
      const config = await loadConfig();
      expect(config.database_url).toBe("postgresql://testhost:5432/testdb");
      expect(config.port).toBe(4000);
      expect(config.claude.model).toBe("claude-opus-4-6");
      expect(config.ollama.host).toBe("http://myhost:11434");
      expect(config.ollama.model).toBe("deepseek-coder");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
