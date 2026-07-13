import { describe, expect, it } from "vitest";

import { createCheckoutOrderDraft } from "./orderDrafts";
import { defaultHours } from "./lib/adminConfig";

type QueryResult = {
  first?: () => Promise<Record<string, unknown> | null>;
  take?: () => Promise<[]>;
  unique?: () => Promise<{ data: unknown } | null>;
};

describe("checkout draft operating-hour gate", () => {
  it("rejects a crafted closed-day draft before writing an order", async () => {
    let rateInsertCount = 0;
    const insert = async (table: string) => {
      if (table === "publicGatewayRateLimits") return `rate_${++rateInsertCount}`;
      throw new Error("order insert must not run");
    };
    const ctx = {
      db: {
        query(table: string) {
          return {
            withIndex(): QueryResult {
              if (table === "publicGatewayRateLimits") {
                return { unique: async () => null, take: async () => [] };
              }
              if (table === "orders") return { first: async () => null };
              if (table === "config") {
                return {
                  unique: async () => ({
                    data: {
                      ...defaultHours,
                      Monday: { open: "09:00", close: "00:00", closed: true }
                    }
                  })
                };
              }
              throw new Error(`Unexpected table ${table}`);
            }
          };
        },
        insert
      }
    };
    const mutation = createCheckoutOrderDraft as unknown as {
      _handler: (context: typeof ctx, args: Record<string, unknown>) => Promise<unknown>;
    };

    await expect(
      mutation._handler(ctx, {
        gatewayRateLimitKey: "a".repeat(64),
        packageKey: "general",
        adults: 1,
        visitDate: "2026-07-13",
        entryTime: "14:00",
        customerEmail: "guest@example.com",
        idempotencyKey: "checkout_closed_001"
      })
    ).rejects.toThrow("outside the configured operating hours");
  });

  it.each([
    ["expired", "Checkout order draft has expired"],
    ["canceled", "Checkout order cannot be reused from status canceled"],
    ["paid", "Checkout order cannot be reused from status paid"]
  ])("rejects replay of a terminal %s order", async (status, expectedMessage) => {
    let rateInsertCount = 0;
    const ctx = {
      db: {
        query(table: string) {
          return {
            withIndex(): QueryResult {
              if (table === "publicGatewayRateLimits") {
                return { unique: async () => null, take: async () => [] };
              }
              if (table === "orders") {
                return {
                  first: async () => ({
                    orderRef: "ORD-TERMINAL",
                    status,
                    draftFingerprint: "terminal-row",
                    createdAt: 1
                  })
                };
              }
              throw new Error(`Unexpected table ${table}`);
            }
          };
        },
        async insert(table: string) {
          if (table === "publicGatewayRateLimits") return `rate_${++rateInsertCount}`;
          throw new Error("terminal replay must not write an order");
        }
      }
    };
    const mutation = createCheckoutOrderDraft as unknown as {
      _handler: (context: typeof ctx, args: Record<string, unknown>) => Promise<unknown>;
    };

    await expect(
      mutation._handler(ctx, {
        gatewayRateLimitKey: "b".repeat(64),
        packageKey: "general",
        adults: 1,
        visitDate: "2026-07-14",
        entryTime: "14:00",
        customerEmail: "guest@example.com",
        idempotencyKey: "checkout_terminal_001"
      })
    ).rejects.toThrow(expectedMessage);
  });
});
