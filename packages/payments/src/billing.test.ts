import { describe, expect, it } from "vitest";

import {
  billingDisplayRefPattern,
  billingVocabularies,
  isBillingDisplayRef,
  isBillingVocabularyValue
} from "./index";
import { orderRefFromId, saleRefFromId } from "./records";

describe("Billing safe display references", () => {
  it("accepts current generated references and the migration fingerprint shape", () => {
    const now = Date.UTC(2026, 9, 2);
    expect(isBillingDisplayRef(orderRefFromId("record-id-abc123", now))).toBe(true);
    expect(isBillingDisplayRef(saleRefFromId("record-id-abc123", now))).toBe(true);
    expect(isBillingDisplayRef("LEGACY-0123456789ABCDEF")).toBe(true);
  });

  it.each([
    "guest@example.com", "https://example.com/payment?token=canary", "cs_test_CANARY",
    "pi_CANARY", "sk_test_CANARY", "arbitrary-old-reference", "SKY2607-LEGACY-RAW",
    "sky2610-ABC123", "SKY2610-abc123", "SKY2610-ABC123 ", " SKY2610-ABC123",
    "SKY2610-ABC123\n", "SKY2610-ABC123\r\n", "SKY2610-ABC123\u0000",
    "SALE261002-ABC123extra", "LEGACY-0123456789abcdef", "LEGACY-0123456789ABCDE",
    "LEGACY-0123456789ABCDEFG", "", null, undefined, 123,
    { toString: () => "SKY2610-ABC123" }
  ])("withholds unsafe or noncanonical reference %#", (value) => {
    expect(isBillingDisplayRef(value)).toBe(false);
  });

  it("requires the entire original reference and remains stable across repeated reads", () => {
    expect(billingDisplayRefPattern.test("SKY2610-ABC123")).toBe(true);
    expect(isBillingDisplayRef("SKY2610-ABC123\n")).toBe(false);
    expect(isBillingDisplayRef("SKY2610-ABC123")).toBe(true);
    expect(isBillingDisplayRef("SKY2610-ABC123")).toBe(true);
  });
});

describe("Billing closed transport vocabulary", () => {
  it("keeps permission, settlement, refund and email facts in their separate domains", () => {
    expect(isBillingVocabularyValue("roles", "viewer")).toBe(true);
    expect(isBillingVocabularyValue("roles", "pos")).toBe(false);
    expect(isBillingVocabularyValue("bookingStates", "cancelled")).toBe(true);
    expect(isBillingVocabularyValue("bookingStates", "canceled")).toBe(false);
    expect(isBillingVocabularyValue("ownerStates", "canceled")).toBe(true);
    expect(isBillingVocabularyValue("refundStates", "pending")).toBe(true);
    expect(isBillingVocabularyValue("paymentStates", "pending")).toBe(false);
    expect(isBillingVocabularyValue("emailProviderStates", "accepted")).toBe(true);
    expect(isBillingVocabularyValue("terminalProviderStates", "requires_capture")).toBe(false);
    expect(isBillingVocabularyValue("safeReasonCodes", "intent_requires_capture")).toBe(true);
    expect(isBillingVocabularyValue("schedules", "healthy")).toBe(false);
  });

  it.each([
    "toString", "constructor", "__proto__", "---", "email_provider_418",
    "email_provider_429 https://example.com/private", "paid_payment_identity_conflict\n",
    "stripe_400_invalid_request_error_sk_test_CANARY", "session_guest@example.com_paid",
    null, false, { toString: () => "refund_history_invalid" }
  ])("does not admit an unknown code, suffix or coercible value %#", (value) => {
    expect(isBillingVocabularyValue("exceptionCodes", value)).toBe(false);
    expect(isBillingVocabularyValue("safeReasonCodes", value)).toBe(false);
  });

  it("recognizes exact reviewed codes without widening stored provider strings", () => {
    expect(isBillingVocabularyValue("exceptionCodes", "refund_history_invalid")).toBe(true);
    expect(isBillingVocabularyValue("safeReasonCodes", "session_expired_no_payment_required")).toBe(true);
    expect(isBillingVocabularyValue("auditActions", "pos.terminalWebhook.failed")).toBe(true);
    expect(isBillingVocabularyValue("auditActions", "ticket.deliverySent")).toBe(false);
    expect(isBillingVocabularyValue("apiVersions", "2026-02-25.clover")).toBe(true);
    expect(isBillingVocabularyValue("apiVersions", "https://example.com/credential")).toBe(false);
  });

  it("cannot be expanded by a consuming lane at runtime", () => {
    expect(Object.isFrozen(billingVocabularies)).toBe(true);
    for (const values of Object.values(billingVocabularies)) {
      expect(Object.isFrozen(values)).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    }
    expect(() => (billingVocabularies.roles as unknown as string[]).push("pos")).toThrow(TypeError);
    expect(isBillingVocabularyValue("roles", "pos")).toBe(false);
  });
});
