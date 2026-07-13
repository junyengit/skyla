import { describe, expect, it } from "vitest";

import { getExperienceInquiryDetail, listExperienceInquiries, updateExperienceInquiry } from "./admin";

type TableName = "staffUsers" | "inquiries" | "auditEvents";
type Doc = Record<string, any>;
type State = Record<TableName, Doc[]>;

const subject = "staff_subject_123";
const inquiryId = "inquiries_1";

function handler<TArgs, TResult>(value: unknown) {
  return (value as { _handler: (ctx: ReturnType<typeof createCtx>["ctx"], args: TArgs) => Promise<TResult> })._handler;
}

function createCtx(role: "admin" | "viewer" = "admin", authenticated = true) {
  const state: State = {
    staffUsers: [
      {
        _id: "staffUsers_1",
        subject,
        emailLower: "ops@example.com",
        role,
        active: true,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    inquiries: [
      {
        _id: inquiryId,
        status: "pending",
        firstName: "Jane",
        lastName: "Smith",
        email: "Jane.Smith@Example.com",
        emailLower: "jane.smith@example.com",
        experience: "champagne-room",
        eventDate: "2026-08-14",
        guestCount: "9-12",
        notes: "Customer requested a window table",
        source: "native-experiences",
        createdAt: 100,
        updatedAt: 100
      }
    ],
    auditEvents: []
  };
  let nextId = 1;

  const ctx = {
    auth: {
      async getUserIdentity() {
        return authenticated ? { subject } : null;
      }
    },
    db: {
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            build?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown
          ) {
            const filters: Array<{ field: string; value: unknown }> = [];
            const query = {
              eq(field: string, value: unknown) {
                filters.push({ field, value });
                return query;
              }
            };
            build?.(query);
            const matching = () =>
              state[table].filter((doc) => filters.every(({ field, value }) => doc[field] === value));
            const result = {
              async unique() {
                const docs = matching();
                if (docs.length > 1) throw new Error("Expected unique result");
                return docs[0] ?? null;
              },
              order(direction: "asc" | "desc") {
                const ordered = [...matching()].sort((left, right) =>
                  direction === "desc" ? right.createdAt - left.createdAt : left.createdAt - right.createdAt
                );
                return {
                  async take(count: number) {
                    return ordered.slice(0, count);
                  }
                };
              }
            };
            return result;
          }
        };
      },
      async get(id: string) {
        return Object.values(state)
          .flat()
          .find((doc) => doc._id === id) ?? null;
      },
      async patch(id: string, value: Doc) {
        const doc = Object.values(state)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!doc) throw new Error(`Missing ${id}`);
        Object.assign(doc, value);
      },
      async insert(table: TableName, value: Doc) {
        const doc = { ...value, _id: `${table}_${nextId++}` };
        state[table].push(doc);
        return doc._id;
      }
    }
  };

  return { ctx, state };
}

describe("admin experience inquiry operations", () => {
  it("requires staff authorization before listing inquiry summaries", async () => {
    const { ctx } = createCtx("viewer", false);

    await expect(
      handler<{ limit?: number }, unknown>(listExperienceInquiries)(ctx, { limit: 25 })
    ).rejects.toThrow("Staff authentication is required");
  });

  it("masks contact PII and omits names and notes from broad lists", async () => {
    const { ctx } = createCtx("viewer");

    const result = await handler<
      { limit?: number; status?: "pending" },
      { inquiries: Array<Record<string, unknown>> }
    >(listExperienceInquiries)(ctx, { limit: 25 });

    expect(result.inquiries).toEqual([
      expect.objectContaining({
        inquiryId,
        status: "pending",
        contactMasked: "J***@E***.com",
        experience: "champagne-room"
      })
    ]);
    expect(JSON.stringify(result.inquiries)).not.toContain("Jane.Smith@Example.com");
    expect(JSON.stringify(result.inquiries)).not.toContain("Jane");
    expect(JSON.stringify(result.inquiries)).not.toContain("Smith");
    expect(JSON.stringify(result.inquiries)).not.toContain("window table");
  });

  it("enforces the inquiry list bound inside Convex", async () => {
    const { ctx } = createCtx("viewer");

    await expect(
      handler<{ limit?: number }, unknown>(listExperienceInquiries)(ctx, { limit: 51 })
    ).rejects.toThrow("limit must be an integer between 1 and 50");
  });

  it("reveals contact details only through a staff-authorized detail query", async () => {
    const { ctx } = createCtx("viewer");

    const result = await handler<
      { inquiryId: string },
      { inquiry: { firstName?: string; lastName?: string; email?: string; notes?: string } }
    >(getExperienceInquiryDetail)(ctx, { inquiryId });

    expect(result.inquiry).toMatchObject({
      firstName: "Jane",
      lastName: "Smith",
      email: "Jane.Smith@Example.com",
      notes: "Customer requested a window table"
    });
  });

  it("allows only admins to update inquiry triage", async () => {
    const { ctx } = createCtx("viewer");

    await expect(
      handler<{ inquiryId: string; status: "contacted" }, unknown>(updateExperienceInquiry)(ctx, {
        inquiryId,
        status: "contacted"
      })
    ).rejects.toThrow("Staff role must be one of: admin");
  });

  it("updates status and notes with a compact audit event that excludes PII", async () => {
    const { ctx, state } = createCtx("admin");

    const result = await handler<
      { inquiryId: string; status: "qualified"; notes: string },
      { status: string; notes?: string; updatedAt?: number }
    >(updateExperienceInquiry)(ctx, {
      inquiryId,
      status: "qualified",
      notes: "  Follow up with private-event menu  "
    });

    expect(result).toMatchObject({ status: "qualified", notes: "Follow up with private-event menu" });
    expect(result.updatedAt).toEqual(expect.any(Number));
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({
      actorStaffUserId: "staffUsers_1",
      action: "admin.inquiryTriage.update",
      entityType: "inquiry",
      entityRef: inquiryId,
      metadata: {
        statusChanged: true,
        notesChanged: true,
        fromStatus: "pending",
        toStatus: "qualified"
      }
    });
    expect(JSON.stringify(state.auditEvents[0])).not.toContain("private-event menu");
    expect(JSON.stringify(state.auditEvents[0])).not.toContain("Jane.Smith@Example.com");
  });

  it("rejects empty updates and oversized notes without writing audit events", async () => {
    const { ctx, state } = createCtx("admin");
    const update = handler<{ inquiryId: string; notes?: string }, unknown>(updateExperienceInquiry);

    await expect(update(ctx, { inquiryId })).rejects.toThrow("status or notes is required");
    await expect(update(ctx, { inquiryId, notes: "x".repeat(2001) })).rejects.toThrow(
      "notes must be 2000 characters or fewer"
    );
    expect(state.auditEvents).toHaveLength(0);
  });

  it("does not create audit noise for an unchanged inquiry", async () => {
    const { ctx, state } = createCtx("admin");

    await handler<{ inquiryId: string; status: "pending" }, unknown>(updateExperienceInquiry)(ctx, {
      inquiryId,
      status: "pending"
    });

    expect(state.auditEvents).toHaveLength(0);
  });
});
