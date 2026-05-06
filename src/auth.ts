import NextAuth from "next-auth";
import { ADMIN_PROVIDER_ID, VIEWER_PROVIDER_ID, authConfig } from "@/auth.config";
import { upsertUser } from "@/db/index";
import { encryptToken } from "@/lib/token-crypto";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, profile, account }) {
      if (profile?.id && account?.provider) {
        const githubId = profile.id.toString();
        const githubLogin = (profile as { login?: string }).login ?? githubId;
        const role: "admin" | "viewer" =
          account.provider === ADMIN_PROVIDER_ID ? "admin" : "viewer";

        token.githubId = githubId;
        token.githubLogin = githubLogin;
        token.role = role;

        // Only store an access token for admins; viewers have nothing to do
        // with git operations and their token would be wasted storage + risk.
        const shouldStoreToken =
          account.provider === ADMIN_PROVIDER_ID && Boolean(account.access_token);

        try {
          await upsertUser({
            githubId,
            githubLogin,
            role,
            encryptedAccessToken: shouldStoreToken
              ? encryptToken(account.access_token as string)
              : null,
          });
        } catch (err) {
          console.error("[auth] Failed to persist user:", (err as Error).message);
          throw err;
        }
      }
      return token;
    },
  },
});

export { ADMIN_PROVIDER_ID, VIEWER_PROVIDER_ID };
