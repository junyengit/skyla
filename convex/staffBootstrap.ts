import { v } from "convex/values";

import { mutation } from "./_generated/server";
import {
  assertStaffBootstrapAuthorized,
  normalizeStaffBootstrapInput,
  staffBootstrapAuditMetadata
} from "./lib/staffBootstrap";

declare const process: { env: Record<string, string | undefined> };

const staffRole = v.union(v.literal("admin"), v.literal("pos"), v.literal("viewer"));

export const upsertStaffUser = mutation({
  args: {
    bootstrapToken: v.string(),
    subject: v.string(),
    email: v.string(),
    role: staffRole,
    active: v.optional(v.boolean()),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    assertStaffBootstrapAuthorized(args.bootstrapToken, process.env.SKYLA_STAFF_BOOTSTRAP_TOKEN);
    const input = normalizeStaffBootstrapInput(args);
    const now = Date.now();
    const existingBySubjectMatches = await ctx.db
      .query("staffUsers")
      .withIndex("by_subject", (q) => q.eq("subject", input.subject))
      .take(2);
    if (existingBySubjectMatches.length > 1) {
      throw new Error("subject already belongs to multiple staff users");
    }
    const existingBySubject = existingBySubjectMatches[0];
    const existingByEmailMatches = await ctx.db
      .query("staffUsers")
      .withIndex("by_emailLower", (q) => q.eq("emailLower", input.emailLower))
      .take(2);
    if (existingByEmailMatches.length > 1) {
      throw new Error("email already belongs to multiple staff users");
    }
    const existingByEmail = existingByEmailMatches[0];

    if (existingByEmail && existingByEmail.subject !== input.subject) {
      throw new Error("email already belongs to a different staff subject");
    }

    const created = !existingBySubject;
    const staffUserId = existingBySubject
      ? existingBySubject._id
      : await ctx.db.insert("staffUsers", {
          subject: input.subject,
          emailLower: input.emailLower,
          role: input.role,
          active: input.active,
          createdAt: now,
          updatedAt: now
        });

    if (existingBySubject) {
      await ctx.db.patch(staffUserId, {
        emailLower: input.emailLower,
        role: input.role,
        active: input.active,
        updatedAt: now
      });
    }

    await ctx.db.insert("auditEvents", {
      action: created ? "staff.bootstrap.create" : "staff.bootstrap.update",
      entityType: "staffUser",
      entityRef: input.subject,
      metadata: staffBootstrapAuditMetadata(input, created),
      createdAt: now
    });

    return {
      staffUserId,
      subject: input.subject,
      emailLower: input.emailLower,
      role: input.role,
      active: input.active,
      created,
      updatedAt: now
    };
  }
});
