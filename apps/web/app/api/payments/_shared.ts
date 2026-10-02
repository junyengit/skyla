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

const terminalPaymentStatePattern = /Terminal payment state:\s*([a-z_]+):\s*([^\n]+)/;
const visitUnavailablePattern = /Visit unavailable:\s*([^\n]+)/;

/**
 * Staff-safe Terminal conflicts from Convex (payment already received,
 * outcome unknown, reader busy, ...) and calendar refusals keep their code and
 * fixed message; anything else stays a generic error.
 */
export function terminalStateFailure(message: string) {
  const state = terminalPaymentStatePattern.exec(message);
  if (state) return { error: state[2].trim(), code: state[1] };
  const visit = visitUnavailablePattern.exec(message);
  if (visit) return { error: `Visit unavailable: ${visit[1].trim()}`, code: "visit_unavailable" };
  return null;
}

export function paymentProviderUnavailable(label: string) {
  return {
    error: `${label} could not be reached right now`,
    code: "payment_provider_unavailable"
  };
}
