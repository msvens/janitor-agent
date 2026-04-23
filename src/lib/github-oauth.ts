/**
 * Revoke the OAuth grant for a specific user token.
 *
 * Calls `DELETE /applications/{client_id}/grant` on GitHub's API, which removes
 * the app from the user's Authorized Apps page (github.com/settings/applications)
 * and invalidates the token. Next sign-in will show the consent screen again.
 *
 * Docs: https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization
 */
export async function revokeGitHubGrant(accessToken: string): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set");
  }

  const authHeader =
    "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(
    `https://api.github.com/applications/${clientId}/grant`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: authHeader,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    },
  );

  // 204 = revoked. 422 = token doesn't match grant (already revoked / invalid). Treat as success.
  if (res.status !== 204 && res.status !== 422) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub grant revocation returned ${res.status}: ${body}`);
  }
}
