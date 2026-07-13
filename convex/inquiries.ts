import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import {
  assertSameInquiryFingerprint,
  inquiryAuditMetadata,
  inquiryFingerprint,
  inquiryResult,
  normalizeInquiryArgs
} from "./lib/inquiries";
import { consumePublicGatewayRateLimit } from "./lib/publicGateway";

const inquiryExperience = v.union(
  v.literal("date-night"),
  v.literal("champagne-caviar"),
  v.literal("family-suite"),
  v.literal("champagne-room"),
  v.literal("private-events"),
  v.literal("other")
);

export const submitInquiry = internalMutation({
  args: {
    gatewayRateLimitKey: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    experience: inquiryExperience,
    eventDate: v.string(),
    guestCount: v.string(),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
    idempotencyKey: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await consumePublicGatewayRateLimit(ctx, "experience-inquiry", args.gatewayRateLimitKey, now);
    const input = normalizeInquiryArgs(args);
    const submissionFingerprint = inquiryFingerprint(input);
    const existingInquiry = await ctx.db
      .query("inquiries")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", input.idempotencyKey))
      .first();

    if (existingInquiry) {
      assertSameInquiryFingerprint(existingInquiry.inquiryFingerprint, submissionFingerprint);
      return inquiryResult(existingInquiry._id, {
        firstName: existingInquiry.firstName ?? input.firstName,
        lastName: existingInquiry.lastName ?? input.lastName,
        email: existingInquiry.email ?? input.email,
        emailLower: existingInquiry.emailLower ?? input.emailLower,
        experience: (existingInquiry.experience as typeof input.experience | undefined) ?? input.experience,
        eventDate: existingInquiry.eventDate ?? input.eventDate,
        guestCount: existingInquiry.guestCount ?? input.guestCount,
        notes: existingInquiry.notes,
        source: existingInquiry.source,
        idempotencyKey: input.idempotencyKey,
        status: existingInquiry.status,
        createdAt: existingInquiry.createdAt,
        updatedAt: existingInquiry.updatedAt
      }, true);
    }

    const record = {
      ...input,
      status: "pending",
      inquiryFingerprint: submissionFingerprint,
      createdAt: now,
      updatedAt: now
    };
    const inquiryId = await ctx.db.insert("inquiries", record);

    await ctx.db.insert("auditEvents", {
      action: "inquiry.submit",
      entityType: "inquiry",
      entityRef: inquiryId,
      metadata: inquiryAuditMetadata(input),
      createdAt: now
    });

    return inquiryResult(inquiryId, record, false);
  }
});
