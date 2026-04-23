import { auth } from "@/auth";
import {
  getUserByGithubId,
  getUserOwnedSummary,
  deleteUserAndRepos,
} from "@/db/index";
import { decryptToken } from "@/lib/token-crypto";
import { revokeGitHubGrant } from "@/lib/github-oauth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await getUserOwnedSummary(githubId);
  return NextResponse.json(summary);
}

export async function DELETE() {
  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByGithubId(githubId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Best-effort: revoke the OAuth grant on GitHub's side so janitor disappears
  // from github.com/settings/applications. Don't block DB cleanup on failure.
  let githubRevoked = false;
  try {
    const token = decryptToken(user.encryptedAccessToken);
    await revokeGitHubGrant(token);
    githubRevoked = true;
  } catch (err) {
    console.error("[account] GitHub grant revocation failed:", (err as Error).message);
  }

  const result = await deleteUserAndRepos(githubId);
  return NextResponse.json({ ...result, githubRevoked });
}
