import { NextResponse } from "next/server";
import { auth } from "@/auth";

export type UserRole = "admin" | "viewer";

export async function getCurrentRole(): Promise<UserRole | null> {
  const session = await auth();
  if (!session?.user?.role) return null;
  return session.user.role;
}

/**
 * Returns null if the caller is admin (allowed to proceed) or a 403 NextResponse
 * the route handler should return immediately. Usage:
 *
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const role = await getCurrentRole();
  if (role === "admin") return null;
  return NextResponse.json(
    { error: "Forbidden: admin role required" },
    { status: 403 },
  );
}
