import { v } from "convex/values";
import { query } from "./_generated/server";
import { billingReadFailure, readBillingDetail, requireBillingStaff, rethrowBillingRead } from "./lib/billingDetails";

/** Exact fresh protected detail; read only, never a worker/provider claim. */
export const getOperationsExceptionDetail = query({
  args: { exceptionId: v.id("operationsExceptions") },
  handler: async (ctx, args) => {
    try {
      const role = await requireBillingStaff(ctx);
      const exception = await ctx.db.get(args.exceptionId);
      if (!exception) return billingReadFailure("billing_record_not_found", args.exceptionId);
      return await readBillingDetail(ctx, exception, role, Date.now());
    } catch (error) { return rethrowBillingRead(error); }
  }
});
