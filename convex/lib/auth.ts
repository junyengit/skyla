import type { StaffRole } from "@skyla/payments";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type StaffUser = {
  _id: Id<"staffUsers">;
  subject: string;
  emailLower: string;
  role: StaffRole;
};

export async function requireStaffUser(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: StaffRole[] = ["admin", "pos"]
): Promise<StaffUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Staff authentication is required");
  }

  const staffUser = await ctx.db
    .query("staffUsers")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();

  if (!staffUser || !staffUser.active || !allowedRoles.includes(staffUser.role)) {
    throw new Error(`Staff role must be one of: ${allowedRoles.join(", ")}`);
  }

  return {
    _id: staffUser._id,
    subject: staffUser.subject,
    emailLower: staffUser.emailLower,
    role: staffUser.role
  };
}
