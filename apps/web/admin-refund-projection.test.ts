import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminSource = readFileSync(join(import.meta.dirname, "../../convex/admin.ts"), "utf8");
const projectionStart = adminSource.indexOf("function publicRefund");
const projectionEnd = adminSource.indexOf("function publicBooking", projectionStart);
const projection = adminSource.slice(projectionStart, projectionEnd);

describe("admin refund projection", () => {
  it("returns an explicit read-only allowlist without internal or raw fields", () => {
    expect(projectionStart).toBeGreaterThanOrEqual(0);
    expect(projection).toContain("providerRefundIdMasked: maskedProviderIdentifier(refund.providerRefundId)");
    expect(projection).toContain(
      "providerPaymentIntentIdMasked: maskedProviderIdentifier(refund.providerPaymentIntentId)"
    );
    expect(projection).toContain("rawEventIdMasked: maskedProviderIdentifier(refund.rawEventId)");
    expect(projection).not.toContain("providerRefundId: refund.providerRefundId");
    expect(projection).toContain("failureReason: refund.failureReason");
    expect(projection).not.toContain("...refund");
    expect(projection).not.toMatch(/\braw\s*:/);
    expect(projection).not.toContain("_id");
    expect(projection).not.toContain("_creationTime");
  });
});
