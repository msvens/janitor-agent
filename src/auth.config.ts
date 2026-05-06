import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

function adminGithubIds(): string[] {
  return (process.env.ADMIN_GITHUB_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function viewerGithubIds(): string[] {
  return (process.env.VIEWER_GITHUB_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const ADMIN_PROVIDER_ID = "github-admin";
export const VIEWER_PROVIDER_ID = "github-viewer";

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      id: ADMIN_PROVIDER_ID,
      name: "GitHub (admin)",
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // `repo` is required for: git push to branches, gh pr create, gh pr comment,
      // reading private repo content for clones. `read:user` and `user:email`
      // cover profile identity.
      authorization: { params: { scope: "repo read:user user:email" } },
    }),
    GitHub({
      id: VIEWER_PROVIDER_ID,
      name: "GitHub (viewer)",
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // Profile-only scope. Viewers cannot push, comment, or clone private
      // repos — they observe the owner's repos via the owner's stored token.
      authorization: { params: { scope: "read:user user:email" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile, account }) {
      const githubId = profile?.id?.toString() ?? "";
      if (!githubId) return false;

      const admins = adminGithubIds();
      const viewers = viewerGithubIds();

      if (account?.provider === ADMIN_PROVIDER_ID) {
        return admins.includes(githubId);
      }
      if (account?.provider === VIEWER_PROVIDER_ID) {
        return admins.includes(githubId) || viewers.includes(githubId);
      }
      return false;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubId = token.githubId as string | undefined;
        session.user.githubLogin = token.githubLogin as string | undefined;
        session.user.role = (token.role as "admin" | "viewer" | undefined) ?? "viewer";
      }
      return session;
    },
  },
};
