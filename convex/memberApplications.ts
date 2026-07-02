import { v } from "convex/values";

import { mutation } from "./_generated/server";
import {
  assertSameMemberApplicationFingerprint,
  memberApplicationAuditMetadata,
  memberApplicationFingerprint,
  memberApplicationResult,
  normalizeMemberApplicationArgs
} from "./lib/memberApplications";

const memberTier = v.union(v.literal("obsidian"), v.literal("gold"), v.literal("black"));

export const submitApplication = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    tier: memberTier,
    source: v.optional(v.string()),
    bio: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const input = normalizeMemberApplicationArgs(args);
    const applicationFingerprint = memberApplicationFingerprint(input);
    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", input.idempotencyKey))
      .first();

    if (existingMember) {
      assertSameMemberApplicationFingerprint(existingMember.applicationFingerprint, applicationFingerprint);
      return memberApplicationResult(existingMember._id, {
        firstName: existingMember.firstName ?? input.firstName,
        lastName: existingMember.lastName ?? input.lastName,
        email: existingMember.email ?? input.email,
        emailLower: existingMember.emailLower ?? input.emailLower,
        phone: existingMember.phone,
        tier: (existingMember.tier as typeof input.tier | undefined) ?? input.tier,
        source: existingMember.source,
        bio: existingMember.bio,
        idempotencyKey: input.idempotencyKey,
        status: existingMember.status,
        createdAt: existingMember.createdAt,
        updatedAt: existingMember.updatedAt
      }, true);
    }

    const record = {
      ...input,
      status: "pending",
      applicationFingerprint,
      createdAt: now,
      updatedAt: now
    };
    const memberId = await ctx.db.insert("members", record);

    await ctx.db.insert("auditEvents", {
      action: "member.application.submit",
      entityType: "member",
      entityRef: memberId,
      metadata: memberApplicationAuditMetadata(input),
      createdAt: now
    });

    return memberApplicationResult(memberId, record, false);
  }
});
