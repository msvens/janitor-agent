import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { upsertUser } from "@/db/index";
import { encryptToken } from "@/lib/token-crypto";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, profile, account }) {
      if (profile?.id) {
        const githubId = profile.id.toString();
        const githubLogin = (profile as { login?: string }).login ?? githubId;
        token.githubId = githubId;
        token.githubLogin = githubLogin;

        if (account?.access_token) {
          try {
            await upsertUser({
              githubId,
              githubLogin,
              encryptedAccessToken: encryptToken(account.access_token),
            });
          } catch (err) {
            console.error("[auth] Failed to persist user token:", (err as Error).message);
            throw err;
          }
        }
      }
      return token;
    },
  },
});
