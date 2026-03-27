import { z } from "zod";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir,
  glob as fsGlob,
} from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./loop.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

function safePath(cwd: string, filePath: string): string {
  const resolved = resolve(cwd, filePath);
  if (!resolved.startsWith(cwd)) {
    throw new Error(`Path escapes working directory: ${filePath}`);
  }
  return resolved;
}

export interface StepTracker {
  current: number;
  max: number;
}

function withStepTag(tracker: StepTracker | undefined, result: string): string {
  if (!tracker) return result;
  tracker.current++;
  const remaining = tracker.max - tracker.current;
  if (remaining <= 3) {
    return `[Step ${tracker.current}/${tracker.max} — ${remaining} steps left, output your summary NOW]\n${result}`;
  }
  return `[Step ${tracker.current}/${tracker.max}]\n${result}`;
}

export function createReadOnlyTools(
  cwd: string,
  stepTracker?: StepTracker,
): Record<string, ToolDefinition> {
  const tools = createTools(cwd, stepTracker);
  return { readFile: tools.readFile, glob: tools.glob, grep: tools.grep };
}

export function createTools(
  cwd: string,
  stepTracker?: StepTracker,
): Record<string, ToolDefinition> {
  return {
    readFile: {
      name: "readFile",
      description:
        "Read the contents of a file. Returns the file text or an error message.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repository root"),
      }),
      execute: async ({ path }) => {
        try {
          console.log(`[tool:readFile] path="${path}"`);
          const content = await fsReadFile(safePath(cwd, path), "utf-8");
          return withStepTag(stepTracker, content);
        } catch (err) {
          return withStepTag(stepTracker, `Error reading ${path}: ${(err as Error).message}`);
        }
      },
    },

    writeFile: {
      name: "writeFile",
      description:
        "Write content to a file, creating parent directories if needed.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repository root"),
        content: z.string().describe("The full file content to write"),
      }),
      execute: async ({ path, content }) => {
        try {
          const fullPath = safePath(cwd, path);
          await mkdir(dirname(fullPath), { recursive: true });
          await fsWriteFile(fullPath, content, "utf-8");
          return withStepTag(stepTracker, `Wrote ${path}`);
        } catch (err) {
          return withStepTag(stepTracker, `Error writing ${path}: ${(err as Error).message}`);
        }
      },
    },

    editFile: {
      name: "editFile",
      description:
        "Replace a specific string in a file. The old_string must appear exactly once.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repository root"),
        old_string: z.string().describe("The exact text to find and replace"),
        new_string: z.string().describe("The replacement text"),
      }),
      execute: async ({ path, old_string, new_string }) => {
        try {
          const fullPath = safePath(cwd, path);
          const fileContent = await fsReadFile(fullPath, "utf-8");
          const occurrences = fileContent.split(old_string).length - 1;
          if (occurrences === 0) {
            return `Error: old_string not found in ${path}`;
          }
          if (occurrences > 1) {
            return `Error: old_string found ${occurrences} times in ${path}, must be unique`;
          }
          const updated = fileContent.replace(old_string, new_string);
          await fsWriteFile(fullPath, updated, "utf-8");
          return withStepTag(stepTracker, `Edited ${path}`);
        } catch (err) {
          return withStepTag(stepTracker, `Error editing ${path}: ${(err as Error).message}`);
        }
      },
    },

    glob: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns matching paths, one per line.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe('Glob pattern (e.g. "**/*.ts", "src/**/*.go", "*.json")'),
      }),
      execute: async ({ pattern }) => {
        try {
          console.log(`[tool:glob] called with pattern="${pattern}" (type=${typeof pattern})`);
          const files: string[] = [];
          for await (const entry of fsGlob(pattern, { cwd })) {
            if (entry.includes("node_modules") || entry.startsWith(".git/")) {
              continue;
            }
            files.push(entry);
            if (files.length >= 200) break;
          }

          const result = files.length > 0 ? files.join("\n") : "No files found";
          return withStepTag(stepTracker, result);
        } catch (err) {
          return withStepTag(stepTracker, `Error globbing: ${(err as Error).message}`);
        }
      },
    },

    grep: {
      name: "grep",
      description:
        "Search file contents for a pattern. Returns matching file paths.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (basic regex)"),
        path: z
          .string()
          .describe('Directory or file to search in (default: ".")')
          .default("."),
      }),
      execute: async ({ pattern, path }) => {
        try {
          const searchPath = safePath(cwd, path);
          const { stdout } = await execFileAsync(
            "grep",
            [
              "-rn",
              "--include=*.ts",
              "--include=*.js",
              "--include=*.tsx",
              "--include=*.jsx",
              "--include=*.json",
              "--include=*.yaml",
              "--include=*.yml",
              "--include=*.md",
              "--include=*.go",
              "--include=*.py",
              "--include=*.java",
              "--include=*.rs",
              "--include=*.toml",
              "--include=*.css",
              "--include=*.html",
              "-l",
              pattern,
              searchPath,
            ],
            { maxBuffer: 1024 * 1024 },
          );
          const lines = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => relative(cwd, line) || line);
          const result =
            lines.length > 0 ? lines.slice(0, 100).join("\n") : "No matches found";
          return withStepTag(stepTracker, result);
        } catch (err) {
          if ((err as { code?: number }).code === 1) {
            return withStepTag(stepTracker, "No matches found");
          }
          return withStepTag(stepTracker, `Error searching: ${(err as Error).message}`);
        }
      },
    },

    bash: {
      name: "bash",
      description:
        "Execute a shell command in the repository directory. Use for tasks that other tools cannot handle.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute"),
      }),
      execute: async ({ command }) => {
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
          const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : ""))
            .trim()
            .slice(0, 10_000);
          return withStepTag(stepTracker, output || "(no output)");
        } catch (err) {
          const msg = (err as Error).message.slice(0, 2000);
          return withStepTag(stepTracker, `Error: ${msg}`);
        }
      },
    },
  };
}
