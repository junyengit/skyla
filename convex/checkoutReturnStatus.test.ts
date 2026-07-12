import { describe, expect, it } from "vitest";

import { normalizeCheckoutReturnIdentity, projectCheckoutReturnStatus } from "./lib/checkoutReturnStatus";

describe("checkout return status", () => {
  it("requires a stored-looking order ref and high-entropy Stripe session id", () => {
    expect(normalizeCheckoutReturnIdentity(" cs_test_abc123xyz7890123 ")).toEqual({
      checkoutSessionId: "cs_test_abc123xyz7890123"
    });
    expect(() => normalizeCheckoutReturnIdentity("not-a-session")).toThrow(
      "checkoutSessionId is invalid"
    );
    expect(() => normalizeCheckoutReturnIdentity("cs_test_short")).toThrow("checkoutSessionId is invalid");
  });

  it("confirms only when paid ledger, paid order, and booking agree", () => {
    expect(projectCheckoutReturnStatus({ orderStatus: "paid", paymentStatuses: ["created", "paid"], bookingExists: true }))
      .toBe("confirmed");
    expect(projectCheckoutReturnStatus({ orderStatus: "paid", paymentStatuses: ["created", "paid"], bookingExists: false }))
      .toBe("pending");
  });

  it("projects terminal failures without treating the browser return as authority", () => {
    expect(projectCheckoutReturnStatus({ orderStatus: "payment_pending", paymentStatuses: ["created", "failed"], bookingExists: false }))
      .toBe("failed");
    expect(projectCheckoutReturnStatus({ orderStatus: "canceled", paymentStatuses: ["created", "canceled"], bookingExists: false }))
      .toBe("canceled");
    expect(projectCheckoutReturnStatus({ orderStatus: "payment_pending", paymentStatuses: ["created"], bookingExists: false }))
      .toBe("pending");
  });
});
