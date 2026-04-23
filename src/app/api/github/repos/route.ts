import { auth } from "@/auth";
import { getUserByGithubId } from "@/db/index";
import { decryptToken } from "@/lib/token-crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface GithubRepo {
  full_name: string;
  description: string | null;
  private: boolean;
  archived: boolean;
  default_branch: string;
  pushed_at: string;
  permissions?: { push?: boolean };
}

export async function GET() {
  const session = await auth();
  const githubId = session?.user?.githubId;
  if (!githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByGithubId(githubId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const token = decryptToken(user.encryptedAccessToken);
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `GitHub API returned ${res.status}`, details: body.slice(0, 500) },
      { status: 502 },
    );
  }

  const all = (await res.json()) as GithubRepo[];
  const pushable = all
    .filter((r) => r.permissions?.push === true && !r.archived)
    .map((r) => ({
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      pushed_at: r.pushed_at,
    }));

  return NextResponse.json(pushable);
}