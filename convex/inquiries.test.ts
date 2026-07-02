import { describe, expect, it } from "vitest";

import {
  assertSameInquiryFingerprint,
  inquiryAuditMetadata,
  inquiryFingerprint,
  inquiryResult,
  normalizeInquiryArgs
} from "./lib/inquiries";

const now = Date.UTC(2026, 6, 4, 12);

describe("inquiry helpers", () => {
  it("normalizes inquiry details and ignores browser-spoofed status fields", () => {
    const input = normalizeInquiryArgs({
      firstName: " Jane ",
      lastName: " Smith ",
      email: " Jane@Example.com ",
      experience: "champagne-room",
      eventDate: "2026-07-10",
      guestCount: "9-12",
      notes: "  Window timing, please  ",
      source: " native-experiences ",
      idempotencyKey: "inquiry_apply_0001",
      status: "approved",
      createdAt: 1
    } as Parameters<typeof normalizeInquiryArgs>[0] & { status: string; createdAt: number });

    expect(input).toEqual({
      firstName: "Jane",
      lastName: "Smith",
      email: "Jane@Example.com",
      emailLower: "jane@example.com",
      experience: "champagne-room",
      eventDate: "2026-07-10",
      guestCount: "9-12",
      notes: "Window timing, please",
      source: "native-experiences",
      idempotencyKey: "inquiry_apply_0001"
    });
  });

  it("normalizes equivalent inquiries to the same fingerprint", () => {
    const first = normalizeInquiryArgs({
      firstName: "Jane",
      lastName: "Smith",
      email: "JANE@EXAMPLE.COM",
      experience: "date-night",
      eventDate: "2026-07-10",
      guestCount: "2",
      idempotencyKey: "inquiry_apply_0002"
    });
    const second = normalizeInquiryArgs({
      firstName: " Jane ",
      lastName: " Smith ",
      email: "jane@example.com",
      experience: "date-night",
      eventDate: "2026-07-10",
      guestCount: "2",
      idempotencyKey: "inquiry_apply_0002"
    });

    expect(inquiryFingerprint(first)).toBe(inquiryFingerprint(second));
    expect(() => assertSameInquiryFingerprint(inquiryFingerprint(first), inquiryFingerprint(second))).not.toThrow();
  });

  it("rejects invalid email, experience, date, guests, and idempotency reuse", () => {
    expect(() =>
      normalizeInquiryArgs({
        firstName: "Jane",
        lastName: "Smith",
        email: "not-an-email",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0003"
      })
    ).toThrow("email must be a valid email address");

    expect(() =>
      normalizeInquiryArgs({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026/07/10",
        guestCount: "900",
        idempotencyKey: "inquiry_apply_0004"
      })
    ).toThrow("eventDate must be YYYY-MM-DD");

    const first = normalizeInquiryArgs({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      experience: "date-night",
      eventDate: "2026-07-10",
      guestCount: "2",
      idempotencyKey: "inquiry_apply_0005"
    });
    const second = normalizeInquiryArgs({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      experience: "champagne-room",
      eventDate: "2026-07-10",
      guestCount: "2",
      idempotencyKey: "inquiry_apply_0005"
    });
    expect(() => assertSameInquiryFingerprint(inquiryFingerprint(first), inquiryFingerprint(second))).toThrow(
      "idempotencyKey was already used for a different inquiry"
    );
  });

  it("keeps public results and audit metadata bounded", () => {
    const input = normalizeInquiryArgs({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      experience: "private-events",
      eventDate: "2026-07-10",
      guestCount: "13+",
      source: "native-experiences",
      idempotencyKey: "inquiry_apply_0006"
    });

    expect(inquiryResult("inquiry_123", { ...input, status: "pending", createdAt: now })).toEqual({
      inquiryId: "inquiry_123",
      emailLower: "jane@example.com",
      experience: "private-events",
      eventDate: "2026-07-10",
      guestCount: "13+",
      status: "pending",
      createdAt: now,
      replayed: false
    });
    expect(inquiryAuditMetadata(input)).toEqual({
      emailLower: "jane@example.com",
      experience: "private-events",
      eventDate: "2026-07-10",
      guestCount: "13+",
      source: "native-experiences"
    });
  });
});
