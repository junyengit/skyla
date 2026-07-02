import { describe, expect, it } from "vitest";

import {
  bookingStatusPatch,
  memberStatusPatch,
  normalizeAdminNote,
  statusAuditMetadata
} from "./lib/adminOperations";

const now = Date.UTC(2026, 6, 4, 12);

describe("admin operation helpers", () => {
  it("builds reversible booking status patches", () => {
    expect(bookingStatusPatch("checked-in", now)).toEqual({
      status: "checked-in",
      updatedAt: now,
      checkedInAt: now,
      cancelledAt: undefined
    });

    expect(bookingStatusPatch("cancelled", now)).toEqual({
      status: "cancelled",
      updatedAt: now,
      cancelledAt: now
    });

    expect(bookingStatusPatch("confirmed", now)).toEqual({
      status: "confirmed",
      updatedAt: now,
      checkedInAt: undefined,
      cancelledAt: undefined
    });
  });

  it("builds member status patches without deleting application data", () => {
    expect(memberStatusPatch("approved", now)).toEqual({ status: "approved", updatedAt: now });
    expect(memberStatusPatch("waitlisted", now)).toEqual({ status: "waitlisted", updatedAt: now });
    expect(memberStatusPatch("rejected", now)).toEqual({ status: "rejected", updatedAt: now });
  });

  it("normalizes bounded audit notes", () => {
    expect(normalizeAdminNote("  front desk override  ")).toBe("front desk override");
    expect(normalizeAdminNote("   ")).toBeUndefined();
    expect(() => normalizeAdminNote("x".repeat(161))).toThrow("note must be 160 characters or fewer");
  });

  it("keeps audit metadata string-only and compact", () => {
    expect(statusAuditMetadata("pending", "approved", "reviewed")).toEqual({
      fromStatus: "pending",
      toStatus: "approved",
      note: "reviewed"
    });
    expect(statusAuditMetadata(undefined, "confirmed")).toEqual({
      fromStatus: "unknown",
      toStatus: "confirmed"
    });
  });
});
