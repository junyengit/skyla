import { type NextRequest, NextResponse } from "next/server";

const staffCompatibilityDestinations = new Map([
  ["/admin.html", "/admin"],
  ["/pos.html", "/pos"]
]);

export function proxy(request: NextRequest) {
  const destination = staffCompatibilityDestinations.get(request.nextUrl.pathname);
  if (!destination) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = destination;

  const response = NextResponse.redirect(target, 308);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin.html", "/pos.html"]
};
