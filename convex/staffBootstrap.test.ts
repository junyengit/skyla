import { describe, expect, it } from "vitest";

import {
  assertStaffBootstrapAuthorized,
  normalizeStaffBootstrapInput,
  staffBootstrapAuditMetadata
} from "./lib/staffBootstrap";

const strongToken = "skyla_bootstrap_1234567890abcdef1234567890abcdef";

describe("staff bootstrap helpers", () => {
  it("requires a configured strong bootstrap token and exact caller token", () => {
    expect(() => assertStaffBootstrapAuthorized(strongToken, undefined)).toThrow(
      "SKYLA_STAFF_BOOTSTRAP_TOKEN is not configured"
    );
    expect(() => assertStaffBootstrapAuthorized(strongToken, "short")).toThrow(
      "SKYLA_STAFF_BOOTSTRAP_TOKEN must be at least 32 characters"
    );
    expect(() => assertStaffBootstrapAuthorized("wrong", strongToken)).toThrow("bootstrap token is not authorized");
    expect(() => assertStaffBootstrapAuthorized(`${strongToken} `, strongToken)).toThrow(
      "bootstrapToken must not contain whitespace"
    );
    expect(() => assertStaffBootstrapAuthorized(strongToken, strongToken)).not.toThrow();
  });

  it("normalizes a staff bootstrap payload for safe insertion", () => {
    expect(
      normalizeStaffBootstrapInput({
        subject: "  user_abc123  ",
        email: " OWNER@SKYDECKLA.COM ",
        role: "admin",
        note: "  first admin  "
      })
    ).toEqual({
      subject: "user_abc123",
      emailLower: "owner@skydeckla.com",
      role: "admin",
      active: true,
      note: "first admin"
    });
  });

  it("allows explicitly deactivating a seeded staff user", () => {
    expect(
      normalizeStaffBootstrapInput({
        subject: "user_viewer",
        email: "viewer@skydeckla.com",
        role: "viewer",
        active: false
      })
    ).toMatchObject({
      role: "viewer",
      active: false
    });
  });

  it("rejects malformed staff identity fields", () => {
    expect(() => normalizeStaffBootstrapInput({ subject: "", email: "a@b.com", role: "admin" })).toThrow(
      "subject is required"
    );
    expect(() =>
      normalizeStaffBootstrapInput({ subject: `user_${"\n"}abc`, email: "a@b.com", role: "admin" })
    ).toThrow("subject must not contain control characters");
    expect(() => normalizeStaffBootstrapInput({ subject: "user", email: "not-an-email", role: "admin" })).toThrow(
      "email must be a valid email address"
    );
    expect(() => normalizeStaffBootstrapInput({ subject: "user", email: "a@b.com", role: "owner" })).toThrow(
      "staff role is not recognized"
    );
    expect(() => normalizeStaffBootstrapInput({ subject: "user", email: "a@b.com", role: "admin", active: "yes" })).toThrow(
      "active must be a boolean"
    );
  });

  it("keeps audit metadata compact and string-or-boolean only", () => {
    const input = normalizeStaffBootstrapInput({
      subject: "user_admin",
      email: "ADMIN@SKYDECKLA.COM",
      role: "admin",
      active: true,
      note: "launch"
    });

    expect(staffBootstrapAuditMetadata(input, true)).toEqual({
      emailLower: "admin@skydeckla.com",
      role: "admin",
      active: true,
      created: true,
      note: "launch"
    });
    expect(() =>
      normalizeStaffBootstrapInput({ subject: "user", email: "a@b.com", role: "admin", note: "x".repeat(161) })
    ).toThrow("note must be 160 characters or fewer");
  });
});
