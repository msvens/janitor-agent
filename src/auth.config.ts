import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

function allowedGithubIds(): string[] {
  return (process.env.ADMIN_GITHUB_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // `repo` is required for: git push to branches, gh pr create, gh pr comment,
      // reading private repo content for clones. `read:user` and `user:email`
      // cover profile identity.
      authorization: { params: { scope: "repo read:user user:email" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const allowed = allowedGithubIds();
      if (allowed.length === 0) return false;
      return allowed.includes(profile?.id?.toString() ?? "");
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.githubId = token.githubId as string | undefined;
        session.user.githubLogin = token.githubLogin as string | undefined;
      }
      return session;
    },
  },
};
