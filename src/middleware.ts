import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "janitor-session";

// Public paths that don't require authentication
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // Check for session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
  }

  // Verify JWT
  try {
    const secret = getJwtSecret();
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    // Invalid or expired token
    const response = redirectToLogin(request);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

function redirectToLogin(request: NextRequest): NextResponse {
  // For API routes, return 401 instead of redirect
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

function getJwtSecret(): Uint8Array {
  // Middleware runs in Edge runtime — can't use loadConfig() (file system access).
  // Read from env var directly.
  const secret = process.env.JANITOR_JWT_SECRET ?? "change-me-in-production";
  return new TextEncoder().encode(secret);
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
