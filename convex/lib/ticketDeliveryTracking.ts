import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const trackDeliveryAction = makeFunctionReference<"action", { deliveryId: Id<"ticketDeliveries"> }, null>(
  "ticketDeliveryTracking:trackTicketDelivery"
);
export function scheduleDeliveryTracking(ctx: MutationCtx, deliveryId: Id<"ticketDeliveries">, at: number) {
  return ctx.scheduler.runAt(at, trackDeliveryAction, { deliveryId });
}
