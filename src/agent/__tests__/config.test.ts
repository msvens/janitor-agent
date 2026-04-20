import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Config module caches CONFIG_PATH on load, so we need to test
// by setting env BEFORE importing. Use dynamic import + jest.resetModules.

describe("loadConfig", () => {
  const origConfig = process.env.JANITOR_CONFIG;
  const origDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (origConfig !== undefined) {
      process.env.JANITOR_CONFIG = origConfig;
    } else {
      delete process.env.JANITOR_CONFIG;
    }
    if (origDbUrl !== undefined) {
      process.env.DATABASE_URL = origDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    jest.resetModules();
  });

  it("returns defaults when no config file exists", async () => {
    process.env.JANITOR_CONFIG = "/tmp/nonexistent-janitor-config.yaml";
    const { loadConfig } = await import("../config");

    const config = await loadConfig();
    expect(config.port).toBe(3003);
    expect(config.ollama.host).toBe("http://localhost:11434");
    expect(config.database_url).toContain("postgresql://");
  });

  it("loads config from YAML file", async () => {
    const tmpDir = join("/tmp", `janitor-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, "config.yaml");

    writeFileSync(configPath, `
database_url: postgresql://testhost:5432/testdb
port: 4000
ollama:
  host: http://myhost:11434
`);

    delete process.env.DATABASE_URL;
    process.env.JANITOR_CONFIG = configPath;
    const { loadConfig } = await import("../config");

    try {
      const config = await loadConfig();
      expect(config.database_url).toBe("postgresql://testhost:5432/testdb");
      expect(config.port).toBe(4000);
      expect(config.ollama.host).toBe("http://myhost:11434");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
