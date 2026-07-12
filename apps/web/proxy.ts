import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextMiddleware, type NextRequest, NextResponse } from "next/server";

const staffCompatibilityDestinations = new Map([
  ["/admin.html", "/admin"],
  ["/pos.html", "/pos"]
]);

let staffAuthMiddleware: NextMiddleware | undefined;

function getStaffAuthMiddleware() {
  staffAuthMiddleware ??= clerkMiddleware();
  return staffAuthMiddleware;
}

function clerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );
}

export function proxy(request: NextRequest, event?: NextFetchEvent) {
  const destination = staffCompatibilityDestinations.get(request.nextUrl.pathname);
  if (destination) {
    const target = request.nextUrl.clone();
    target.pathname = destination;

    const response = NextResponse.redirect(target, 308);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (!clerkConfigured() || !event) return NextResponse.next();

  return getStaffAuthMiddleware()(request, event);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/pos/:path*",
    "/pos-next/:path*",
    "/staff-sign-in/:path*",
    "/api/admin/:path*",
    "/api/pos/:path*",
    "/api/order-drafts/pos",
    "/api/payments/stripe-terminal/:path*",
    "/admin.html",
    "/pos.html"
  ]
};
