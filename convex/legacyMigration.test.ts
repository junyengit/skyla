import { describe, expect, it } from "vitest";

import {
  assertLegacyMigrationAuthorized,
  legacyRecordFingerprint,
  normalizeLegacyBatchIdentity,
  normalizeLegacyBooking,
  normalizeLegacyInquiry,
  normalizeLegacyMember,
  normalizeLegacySource
} from "./lib/legacyMigration";

const token = "migration-token-with-at-least-32-characters";
const createdAt = Date.UTC(2026, 6, 1, 12);
const source = "supabase:sjjtxzantrvipakliczb";

describe("legacy migration normalization", () => {
  it("requires an explicit temporary migration token", () => {
    expect(() => assertLegacyMigrationAuthorized(token, token)).not.toThrow();
    expect(() => assertLegacyMigrationAuthorized("wrong-token-with-at-least-32-chars", token)).toThrow(
      "migration token is not authorized"
    );
    expect(() => assertLegacyMigrationAuthorized(token, "short")).toThrow(
      "SKYLA_DATA_MIGRATION_TOKEN must be at least 32 characters"
    );
  });

  it("accepts the longest source label supported by the offline exporter", () => {
    expect(normalizeLegacySource(`localStorage:${"a".repeat(80)}`)).toHaveLength(93);
  });

  it("normalizes legacy booking fields while retaining the raw source", async () => {
    const record = {
      legacyId: "legacy-booking-1",
      createdAt,
      raw: {
        bookingRef: "SKY2607-LEGACY",
        visitDate: "2026-07-20",
        time: "2:00 PM",
        adults: 2,
        children: 1,
        email: " Guest@Example.com ",
        status: "checked-in",
        checkedInAt: "2026-07-20T21:00:00.000Z"
      }
    };

    expect(await normalizeLegacyBooking(record, "supabase:sjjtxzantrvipakliczb")).toMatchObject({
      bookingRef: "SKY2607-LEGACY",
      visitDate: "2026-07-20",
      entryTime: "2:00 PM",
      partySize: 3,
      emailLower: "guest@example.com",
      status: "checked-in",
      checkedInAt: Date.parse("2026-07-20T21:00:00.000Z"),
      legacyId: "legacy-booking-1",
      legacySource: "supabase:sjjtxzantrvipakliczb",
      rawLegacy: record.raw
    });
  });

  it("normalizes member and inquiry projections without inventing invalid email fields", async () => {
    const member = await normalizeLegacyMember(
      {
        legacyId: "member-1",
        createdAt,
        raw: { firstName: "Ari", lastName: "Lee", email: "bad", tier: "gold", status: "approved" }
      },
      "supabase"
    );
    expect(member).toMatchObject({ firstName: "Ari", lastName: "Lee", email: "bad", tier: "gold", status: "approved" });
    expect(member).not.toHaveProperty("emailLower");

    expect(
      await normalizeLegacyInquiry(
        {
          legacyId: "inquiry-1",
          createdAt,
          raw: { firstName: "Jo", email: "JO@EXAMPLE.COM", experience: "private", guestCount: 20 }
        },
        "supabase"
      )
    ).toMatchObject({ firstName: "Jo", emailLower: "jo@example.com", experience: "private" });
  });

  it("makes record and batch fingerprints deterministic and rejects unsafe batches", async () => {
    const record = {
      legacyId: `${source}:bookings:booking-1`,
      createdAt,
      raw: { status: "confirmed", adults: 2 }
    };
    expect(await legacyRecordFingerprint("bookings", record, source)).toBe(
      await legacyRecordFingerprint("bookings", { ...record, raw: { adults: 2, status: "confirmed" } }, source)
    );
    const first = await normalizeLegacyBatchIdentity({
      source,
      batchId: "skyla:bookings:0001",
      kind: "bookings",
      records: [record]
    });
    const second = await normalizeLegacyBatchIdentity({
      source,
      batchId: "skyla:bookings:0001",
      kind: "bookings",
      records: [{ ...record, raw: { adults: 2, status: "confirmed" } }]
    });
    expect(first.inputHash).toBe(second.inputHash);
    await expect(normalizeLegacyBatchIdentity({ ...first, records: [record, record] })).rejects.toThrow("duplicate legacyId");
    await expect(normalizeLegacyBatchIdentity({ source, batchId: "bad id", kind: "bookings", records: [record] }))
      .rejects.toThrow("URL-safe");
    await expect(
      normalizeLegacyBatchIdentity({
        source,
        batchId: "skyla:bookings:oversized",
        kind: "bookings",
        records: [{ ...record, raw: { payload: "x".repeat(65 * 1024) } }]
      })
    ).rejects.toThrow("exceeds 64 KiB");
    await expect(
      normalizeLegacyBatchIdentity({
        source,
        batchId: "skyla:bookings:wrong-source",
        kind: "bookings",
        records: [{ ...record, legacyId: "supabase:otherproject:bookings:booking-1" }]
      })
    ).rejects.toThrow("complete source and kind namespace");
  });
});
