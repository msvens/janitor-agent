import { execFile, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exec = promisify(execFile);
const execShell = promisify(execCb);

function log(msg: string) {
  console.log(`[github] ${msg}`);
}

export async function ensureWorkspace(
  repo: string,
  workspaceDir: string,
  branch: string,
): Promise<string> {
  const repoDir = join(workspaceDir, repo.replace("/", "-"));
  const gitDir = join(repoDir, ".git");

  try {
    await access(gitDir);
    log(`Updating workspace for ${repo}`);
    await updateWorkspace(repoDir, branch);
  } catch {
    log(`Cloning ${repo} into workspace ${repoDir}`);
    await exec("gh", ["repo", "clone", repo, repoDir]);
    await exec("git", ["checkout", `origin/${branch}`], { cwd: repoDir });
  }

  return repoDir;
}

export async function updateWorkspace(repoDir: string, branch: string): Promise<void> {
  await exec("git", ["fetch", "origin"], { cwd: repoDir });
  await exec("git", ["checkout", `origin/${branch}`], { cwd: repoDir });
  await exec("git", ["clean", "-fd"], { cwd: repoDir });
}

export async function installDeps(
  repoDir: string,
  installCommand?: string,
): Promise<void> {
  if (!installCommand) return;
  log(`Installing dependencies: ${installCommand}`);
  await execShell(installCommand, { cwd: repoDir, timeout: 120_000 });
}

export async function runTests(
  repoDir: string,
  testCommand?: string,
  installCommand?: string,
): Promise<{ passed: boolean; output: string }> {
  if (!testCommand) return { passed: true, output: "" };

  if (installCommand) {
    await installDeps(repoDir, installCommand);
  }

  log(`Running tests: ${testCommand}`);
  try {
    const { stdout, stderr } = await execShell(testCommand, {
      cwd: repoDir,
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "production" },
    });
    const output = (stdout + "\n" + stderr).trim();
    log(`Tests passed`);
    return { passed: true, output };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const output = ((e.stdout ?? "") + "\n" + (e.stderr ?? "")).trim() || e.message;
    log(`Tests failed`);
    return { passed: false, output: output.slice(0, 10000) };
  }
}

export async function cloneRepo(repo: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "janitor-"));
  log(`Cloning ${repo} into ${dir}`);
  await exec("gh", ["repo", "clone", repo, dir, "--", "--depth=1"]);
  return dir;
}

export async function cleanupRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function deleteRemoteBranch(repo: string, branchName: string): Promise<void> {
  try {
    await exec("gh", ["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${branchName}`]);
    log(`Deleted remote branch ${branchName} on ${repo}`);
  } catch {
    // Branch may not exist on remote (never pushed) — ignore
  }
}

export async function createBranch(repoDir: string, branchName: string): Promise<void> {
  await exec("git", ["checkout", "-b", branchName], { cwd: repoDir });
}

export async function hasChanges(repoDir: string): Promise<boolean> {
  const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: repoDir });
  return stdout.trim().length > 0;
}

export async function commitAndPush(
  repoDir: string,
  branchName: string,
  message: string
): Promise<void> {
  await exec("git", ["add", "-A"], { cwd: repoDir });
  await exec("git", ["commit", "-m", message], { cwd: repoDir });
  await exec("git", ["push", "origin", branchName], { cwd: repoDir });
}

export async function createPR(
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<number> {
  log(`Creating PR for ${repo}: ${title}`);
  const { stdout } = await exec("gh", [
    "pr", "create",
    "--repo", repo,
    "--title", title,
    "--body", body,
    "--head", head,
    "--base", base,
    "--label", "janitor-agent",
  ]);
  // gh pr create outputs the PR URL, extract the number
  const match = stdout.trim().match(/\/pull\/(\d+)/);
  if (!match) throw new Error(`Could not parse PR number from: ${stdout}`);
  return parseInt(match[1], 10);
}

export async function ensureLabelExists(repo: string): Promise<void> {
  try {
    await exec("gh", [
      "label", "create", "janitor-agent",
      "--repo", repo,
      "--description", "Automated maintenance PR from janitor-agent",
      "--color", "0E8A16",
      "--force",
    ]);
  } catch {
    // Label may already exist, that's fine
  }
}

interface PRStatus {
  state: "OPEN" | "CLOSED" | "MERGED";
  has_new_comments: boolean;
}

export async function checkPRStatus(repo: string, prNumber: number): Promise<PRStatus> {
  const { stdout } = await exec("gh", [
    "pr", "view", String(prNumber),
    "--repo", repo,
    "--json", "state,reviews,comments",
  ]);
  const data = JSON.parse(stdout);
  const state = data.state as PRStatus["state"];

  // Check for unresolved review comments
  const hasReviews = (data.reviews?.length ?? 0) > 0;
  const hasComments = (data.comments?.length ?? 0) > 0;

  return { state, has_new_comments: hasReviews || hasComments };
}

export async function getOpenJanitorPRs(repo: string): Promise<number[]> {
  const { stdout } = await exec("gh", [
    "pr", "list",
    "--repo", repo,
    "--label", "janitor-agent",
    "--state", "open",
    "--json", "number",
  ]);
  const prs = JSON.parse(stdout) as { number: number }[];
  return prs.map((p) => p.number);
}

export async function closePR(
  repo: string,
  prNumber: number,
  comment: string,
): Promise<void> {
  await exec("gh", [
    "pr", "close", String(prNumber),
    "--repo", repo,
    "--comment", comment,
  ]);
  log(`Closed PR #${prNumber} in ${repo}`);
}

export async function getPRCloseReason(
  repo: string,
  prNumber: number,
): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", [
      "pr", "view", String(prNumber),
      "--repo", repo,
      "--json", "comments",
    ]);
    const data = JSON.parse(stdout);
    const comments = data.comments as { body: string; createdAt: string }[];
    if (!comments || comments.length === 0) return undefined;
    // Return the last comment — typically the close reason
    return comments[comments.length - 1]!.body;
  } catch {
    return undefined;
  }
}

export async function getPRComments(
  repo: string,
  prNumber: number
): Promise<string[]> {
  const { stdout } = await exec("gh", [
    "pr", "view", String(prNumber),
    "--repo", repo,
    "--json", "comments,reviews",
  ]);
  const data = JSON.parse(stdout);
  const comments: string[] = [];

  for (const c of data.comments ?? []) {
    comments.push(c.body);
  }
  for (const r of data.reviews ?? []) {
    if (r.body) comments.push(r.body);
  }

  return comments;
}
