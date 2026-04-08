import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "janitor-session";
const TOKEN_EXPIRY = "7d";

function getUsername(): string {
  return process.env.JANITOR_USERNAME ?? "admin";
}

function getPassword(): string {
  return process.env.JANITOR_PASSWORD ?? "";
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JANITOR_JWT_SECRET ?? "change-me-in-production";
  return new TextEncoder().encode(secret);
}

export function verifyCredentials(username: string, password: string): boolean {
  if (!getPassword()) return false;
  return username === getUsername() && password === getPassword();
}

export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<{ username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return { username: payload.username as string };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
