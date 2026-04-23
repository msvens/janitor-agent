import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `token` as the ambient GitHub token. Subprocess calls that use
 * `ghEnv()` will see `GH_TOKEN`/`GITHUB_TOKEN` set to this value. If `token` is
 * null, runs without a context — falls back to whatever is in process.env.
 */
export function runWithToken<T>(token: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!token) return fn();
  return store.run(token, fn);
}

/** The token set by the nearest enclosing `runWithToken`, or undefined. */
export function currentToken(): string | undefined {
  return store.getStore();
}

/**
 * Env to pass to child processes that talk to GitHub (gh/git).
 * Merges the ambient token from `runWithToken` on top of `process.env`.
 * If no ambient token, returns `process.env` unchanged — any existing `GH_TOKEN`
 * in the process env is preserved as a fallback.
 */
export function ghEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const t = currentToken();
  const base = t
    ? { ...process.env, GH_TOKEN: t, GITHUB_TOKEN: t }
    : process.env;
  return extra ? { ...base, ...extra } : base;
}
