import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminClient = readFileSync(join(import.meta.dirname, "components/admin-ops-client.tsx"), "utf8");

describe("admin refund visibility", () => {
  it("renders read-only refund details with masked provider identifiers", () => {
    expect(adminClient).toContain("snapshot?.recent.refunds.map");
    expect(adminClient).toContain("money(refund.amountCents)");
    expect(adminClient).toContain("refund.status");
    expect(adminClient).toContain("shortDate(refund.providerEventCreatedAt)");
    expect(adminClient).toContain("refund.providerRefundIdMasked");
    expect(adminClient).toContain("refund.providerPaymentIntentIdMasked");
    expect(adminClient).toContain("refund.rawEventIdMasked");
    expect(adminClient).not.toContain("maskedIdentifier(refund.providerRefundId)");
    expect(adminClient).not.toContain("initiateRefund");
    expect(adminClient).not.toContain("/api/admin/refunds");
  });
});
