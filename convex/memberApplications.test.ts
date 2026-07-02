import { describe, expect, it } from "vitest";

import {
  assertSameMemberApplicationFingerprint,
  memberApplicationAuditMetadata,
  memberApplicationFingerprint,
  memberApplicationResult,
  normalizeMemberApplicationArgs
} from "./lib/memberApplications";

const now = Date.UTC(2026, 6, 4, 12);

describe("member application helpers", () => {
  it("normalizes applicant details and ignores browser-spoofed status fields", () => {
    const input = normalizeMemberApplicationArgs({
      firstName: " Ari ",
      lastName: " Stone ",
      email: " Ari@Example.com ",
      phone: " +1 310 000 0000 ",
      tier: "gold",
      source: " Referred by a current member ",
      bio: " Loves skyline evenings ",
      idempotencyKey: "member_apply_0001",
      status: "approved",
      createdAt: 1
    } as Parameters<typeof normalizeMemberApplicationArgs>[0] & { status: string; createdAt: number });

    expect(input).toEqual({
      firstName: "Ari",
      lastName: "Stone",
      email: "Ari@Example.com",
      emailLower: "ari@example.com",
      phone: "+1 310 000 0000",
      tier: "gold",
      source: "Referred by a current member",
      bio: "Loves skyline evenings",
      idempotencyKey: "member_apply_0001"
    });
  });

  it("normalizes equivalent applications to the same fingerprint", () => {
    const first = normalizeMemberApplicationArgs({
      firstName: "Ari",
      lastName: "Stone",
      email: "ARI@EXAMPLE.COM",
      phone: "   ",
      tier: "gold",
      idempotencyKey: "member_apply_0002"
    });
    const second = normalizeMemberApplicationArgs({
      firstName: " Ari ",
      lastName: " Stone ",
      email: "ari@example.com",
      tier: "gold",
      idempotencyKey: "member_apply_0002"
    });

    expect(memberApplicationFingerprint(first)).toBe(memberApplicationFingerprint(second));
    expect(() =>
      assertSameMemberApplicationFingerprint(memberApplicationFingerprint(first), memberApplicationFingerprint(second))
    ).not.toThrow();
  });

  it("rejects invalid email, tier, lengths, and idempotency reuse", () => {
    expect(() =>
      normalizeMemberApplicationArgs({
        firstName: "Ari",
        lastName: "Stone",
        email: "not-an-email",
        tier: "gold",
        idempotencyKey: "member_apply_0003"
      })
    ).toThrow("email must be a valid email address");

    expect(() =>
      normalizeMemberApplicationArgs({
        firstName: "Ari",
        lastName: "Stone",
        email: "ari@example.com",
        tier: "black",
        bio: "x".repeat(2001),
        idempotencyKey: "member_apply_0004"
      })
    ).toThrow("bio must be 2000 characters or fewer");

    const first = normalizeMemberApplicationArgs({
      firstName: "Ari",
      lastName: "Stone",
      email: "ari@example.com",
      tier: "gold",
      idempotencyKey: "member_apply_0005"
    });
    const second = normalizeMemberApplicationArgs({
      firstName: "Ari",
      lastName: "Stone",
      email: "ari@example.com",
      tier: "black",
      idempotencyKey: "member_apply_0005"
    });
    expect(() =>
      assertSameMemberApplicationFingerprint(memberApplicationFingerprint(first), memberApplicationFingerprint(second))
    ).toThrow("idempotencyKey was already used for a different member application");
  });

  it("keeps public results and audit metadata bounded", () => {
    const input = normalizeMemberApplicationArgs({
      firstName: "Ari",
      lastName: "Stone",
      email: "ari@example.com",
      phone: "+1 310 000 0000",
      tier: "obsidian",
      source: "Word of mouth",
      bio: "Private context for committee only",
      idempotencyKey: "member_apply_0006"
    });

    expect(memberApplicationResult("member_123", { ...input, status: "pending", createdAt: now })).toEqual({
      memberId: "member_123",
      emailLower: "ari@example.com",
      tier: "obsidian",
      status: "pending",
      createdAt: now,
      replayed: false
    });
    expect(memberApplicationAuditMetadata(input)).toEqual({
      emailLower: "ari@example.com",
      tier: "obsidian",
      source: "Word of mouth"
    });
  });
});
