export const bookingAdminStatuses = ["confirmed", "checked-in", "cancelled"] as const;
export const memberAdminStatuses = ["pending", "approved", "waitlisted", "rejected"] as const;

export type BookingAdminStatus = (typeof bookingAdminStatuses)[number];
export type MemberAdminStatus = (typeof memberAdminStatuses)[number];

export function bookingStatusPatch(status: BookingAdminStatus, now: number) {
  const base = { status, updatedAt: now };

  if (status === "checked-in") {
    return { ...base, checkedInAt: now, cancelledAt: undefined };
  }
  if (status === "cancelled") {
    return { ...base, cancelledAt: now };
  }
  return { ...base, checkedInAt: undefined, cancelledAt: undefined };
}

export function memberStatusPatch(status: MemberAdminStatus, now: number) {
  return { status, updatedAt: now };
}

export function normalizeAdminNote(value: string | undefined, maxLength = 160) {
  const note = value?.trim();
  if (!note) {
    return undefined;
  }
  if (note.length > maxLength) {
    throw new Error(`note must be ${maxLength} characters or fewer`);
  }
  return note;
}

export function statusAuditMetadata(fromStatus: string | undefined, toStatus: string, note?: string) {
  const metadata: Record<string, string> = { fromStatus: fromStatus ?? "unknown", toStatus };
  if (note) {
    metadata.note = note;
  }
  return metadata;
}

export function voucherAuditMetadata(
  action: "redeem" | "undo",
  voucher: {
    voucherId: string;
    label: string;
    fromRedeemed: number;
    toRedeemed: number;
    quantity: number;
  },
  note?: string
) {
  const metadata: Record<string, string | number> = {
    action,
    voucherId: voucher.voucherId,
    label: voucher.label,
    fromRedeemed: voucher.fromRedeemed,
    toRedeemed: voucher.toRedeemed,
    quantity: voucher.quantity
  };
  if (note) {
    metadata.note = note;
  }
  return metadata;
}
