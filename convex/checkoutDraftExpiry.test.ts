import { describe, expect, it } from "vitest";

import {
  assertCheckoutDraftCanStartPayment,
  checkoutDraftExpiresAt,
  checkoutDraftIsAbandoned,
  checkoutDraftPaymentStartBufferMs,
  checkoutDraftTtlMs
} from "./lib/checkoutDraftExpiry";

describe("checkout draft expiry", () => {
  it("gives new and legacy drafts the same bounded lifetime", () => {
    expect(checkoutDraftExpiresAt({ createdAt: 1_000 })).toBe(1_000 + checkoutDraftTtlMs);
    expect(checkoutDraftExpiresAt({ createdAt: 1_000, expiresAt: 5_000 })).toBe(5_000);
  });

  it("expires only abandoned drafts", () => {
    expect(checkoutDraftIsAbandoned({ status: "draft", createdAt: 1_000, expiresAt: 2_000 }, 2_000)).toBe(true);
    expect(checkoutDraftIsAbandoned({ status: "payment_pending", createdAt: 1_000, expiresAt: 2_000 }, 2_000)).toBe(false);
  });

  it("keeps payment creation outside the expiry race window", () => {
    expect(() => assertCheckoutDraftCanStartPayment({
      status: "draft",
      createdAt: 1_000,
      expiresAt: 100_000
    }, 100_000 - checkoutDraftPaymentStartBufferMs - 1)).not.toThrow();

    expect(() => assertCheckoutDraftCanStartPayment({
      status: "draft",
      createdAt: 1_000,
      expiresAt: 100_000
    }, 100_000 - checkoutDraftPaymentStartBufferMs)).toThrow("draft has expired");
    expect(() => assertCheckoutDraftCanStartPayment({
      status: "expired",
      createdAt: 1_000,
      expiresAt: 100_000
    }, 10_000)).toThrow("status expired");
  });
});
