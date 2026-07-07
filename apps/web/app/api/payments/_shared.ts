export function paymentJson(
  body: unknown,
  init: ResponseInit = {},
  options: { varyAuthorization?: boolean } = {}
) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  if (options.varyAuthorization) {
    const vary = headers.get("vary");
    const hasAuthorizationVary = vary
      ?.split(",")
      .map((entry) => entry.trim().toLowerCase())
      .includes("authorization");

    if (!hasAuthorizationVary) {
      headers.set("vary", vary ? `${vary}, Authorization` : "Authorization");
    }
  }

  return Response.json(body, {
    ...init,
    headers
  });
}

export function invalidPaymentRequest(message: string) {
  return {
    error: message,
    code: "invalid_payment_request"
  };
}

export function paymentServiceUnavailable(label: string) {
  return {
    error: `${label} is not available right now`,
    code: "payment_service_unavailable"
  };
}

export function paymentForbidden(label: string) {
  return {
    error: `${label} is not allowed for this staff user`,
    code: "staff_forbidden"
  };
}

export function paymentStateConflict(label: string) {
  return {
    error: `${label} is not ready for this action`,
    code: "payment_state_conflict"
  };
}

export function paymentProviderUnavailable(label: string) {
  return {
    error: `${label} could not be reached right now`,
    code: "payment_provider_unavailable"
  };
}
