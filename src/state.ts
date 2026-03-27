import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import type { State } from "./types.js";

const STATE_PATH = resolve(import.meta.dirname, "..", "state.json");

const DEFAULT_STATE: State = {
  open_prs: [],
  repo_history: {},
  last_run: new Date().toISOString(),
};

export async function loadState(): Promise<State> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as State;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: State): Promise<void> {
  state.last_run = new Date().toISOString();
  const tmp = STATE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await rename(tmp, STATE_PATH);
}
