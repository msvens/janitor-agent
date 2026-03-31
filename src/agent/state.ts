import * as db from "../db/index";
import type { State } from "./types";

export async function loadState(): Promise<State> {
  return db.loadState();
}

export async function saveState(state: State): Promise<void> {
  db.saveState(state);
}
