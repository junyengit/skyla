const allowedStaffApiPaths = [
  /^\/api\/admin(?:\/|$)/,
  /^\/api\/pos(?:\/|$)/,
  /^\/api\/order-drafts\/pos$/,
  /^\/api\/payments\/stripe-terminal(?:\/|$)/
];

export function approvedStaffApiUrl(input: string, origin: string) {
  const url = new URL(input, origin);
  if (url.origin !== origin || !allowedStaffApiPaths.some((pattern) => pattern.test(url.pathname))) {
    throw new Error("Staff credentials may only be sent to an approved Skyla API route.");
  }
  return `${url.pathname}${url.search}`;
}
