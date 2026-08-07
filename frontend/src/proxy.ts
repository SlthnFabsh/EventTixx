import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Route di dalam group (dashboard): hanya admin/superadmin yang boleh akses
const ADMIN_ROUTES = [
  "/dashboard",
  "/users",
  "/artists",
  "/songs",
  "/events",
  "/ticket-categories",
];

// Route di dalam group (staff): hanya staff yang boleh akses
const STAFF_ROUTES = ["/scan"];

// TODO: sesuaikan nama cookie token dengan implementasi login Anda
const TOKEN_COOKIE = "token";

// TODO: ganti dengan verifikasi JWT yang benar (mis. pakai library jose),
// kode ini cuma decode base64 payload tanpa verifikasi signature
function getRoleFromToken(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(base64));
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const role = token ? getRoleFromToken(token) : null;

  const isAdminRoute = ADMIN_ROUTES.includes(pathname);
  const isStaffRoute = STAFF_ROUTES.includes(pathname);

  if (isAdminRoute && role !== "admin" && role !== "superadmin") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isStaffRoute && role !== "staff") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/users/:path*",
    "/artists/:path*",
    "/songs/:path*",
    "/events/:path*",
    "/ticket-categories/:path*",
    "/scan/:path*",
  ],
};
